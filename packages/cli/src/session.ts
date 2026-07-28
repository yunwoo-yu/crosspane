import { existsSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  type Browser,
  type BrowserContext,
  chromium,
  devices,
  firefox,
  type Page,
  webkit,
} from 'playwright';
import type { Viewport } from './devices.js';
import {
  type BrowserEngineName,
  type EngineName,
  type EngineStatus,
  FRAME_FLAG_FULL_PAGE,
  type LogLevel,
  SCROLL_Y_UNKNOWN,
} from './protocol.js';

const launchers = { chromium, webkit, firefox } as const;

export interface SessionEvents {
  /** scrollY: 프레임 캡처 시점의 세로 스크롤 위치(CSS px). 알 수 없으면 SCROLL_Y_UNKNOWN */
  onFrame(engine: EngineName, jpeg: Buffer, scrollY: number, flags?: number): void;
  onConsole(engine: EngineName, level: LogLevel, text: string): void;
  onPageError(engine: EngineName, message: string): void;
  onRequestFailed(engine: EngineName, url: string, error: string): void;
  onHttpError(engine: EngineName, url: string, status: number): void;
  onNetwork(
    engine: EngineName,
    entry: {
      method: string;
      url: string;
      status: number;
      resourceType: string;
      durationMs: number;
      responseHeaders?: Record<string, string>;
      bodyPreview?: string;
      bodyTruncated?: boolean;
    },
  ): void;
  onStatus(engine: EngineName, status: EngineStatus, detail?: string, viewOnly?: boolean): void;
  onNavigation(engine: EngineName, url: string): void;
}

/**
 * 입력 미러링 대상의 공통 인터페이스.
 * EngineSession(Playwright)과 IosSimulatorSession(실기기 시뮬레이터)이 구현한다.
 */
export interface InputTarget {
  clickAt(normalizedX: number, normalizedY: number): Promise<void>;
  /** 드래그/스와이프 재생 — 좌표는 0~1 정규화 */
  dragBetween(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    durationMs: number,
  ): Promise<void>;
  scrollBy(deltaY: number, normalizedX?: number, normalizedY?: number): Promise<void>;
  pressKey(key: string): Promise<void>;
  typeText(text: string): Promise<void>;
  goBack(): Promise<void>;
  goForward(): Promise<void>;
  reload(): Promise<void>;
  navigate(url: string): Promise<void>;
  markActivity(): void;
  /** 연속 터치(네이티브 제스처) — 지원 어댑터만 구현 (Android motionevent) */
  touchAt?(phase: 'down' | 'move' | 'up', normalizedX: number, normalizedY: number): Promise<void>;
  /** 대시보드 시청자 유무 — false면 캡처를 멈춰 유휴 CPU를 없앤다 (선택 구현) */
  setViewersActive?(active: boolean): void;
  dispose(): Promise<void>;
}

/**
 * 내비게이션/prefetch 취소로 인한 요청 중단은 정상 동작이다 (예: Next.js가
 * 페이지 이동 시 진행 중이던 prefetch를 끊는 경우). 이걸 에러로 보여주면
 * 멀쩡한 앱에 에러 배지가 쌓여 진짜 에러가 묻힌다.
 */
const ABORTED_REQUEST_PATTERNS = [
  /ERR_ABORTED/, // Chromium
  /NS_BINDING_ABORTED|NS_ERROR_ABORT/, // Firefox
  /cancell?ed/i, // WebKit
];

export function isAbortedRequestError(errorText: string): boolean {
  return ABORTED_REQUEST_PATTERNS.some((pattern) => pattern.test(errorText));
}

export interface SessionOptions {
  url: string;
  device: string;
  injectScriptPath?: string;
  /** 모든 엔진에 그대로 적용할 커스텀 UA (실제 앱의 웹뷰 UA 재현용) */
  customUserAgent?: string;
  /** 웹뷰 환경 에뮬레이션 — UA를 실배포 웹뷰와 동일하게, WKWebView는 SW 차단 */
  emulateWebview: boolean;
  /** 저장된 로그인 세션(storageState)을 무시하고 깨끗하게 시작 */
  freshSession?: boolean;
}

/**
 * 로그인 세션 저장 위치: ~/.crosspane/state/<origin>/<engine>.json
 * 실무 앱은 대부분 로그인 뒤에 있다 — 켤 때마다 전 엔진 재로그인하지 않도록
 * 쿠키/스토리지를 종료 시 저장하고 다음 실행에서 복원한다. (오리진별 분리)
 */
export function sessionStatePath(targetUrl: string, engine: BrowserEngineName): string {
  const origin = new URL(targetUrl).origin.replace(/[^a-zA-Z0-9]+/g, '_');
  return join(homedir(), '.crosspane', 'state', origin, `${engine}.json`);
}

/**
 * 실배포 웹뷰의 UA를 재현한다. UA 스니핑으로 분기하는 앱 코드가
 * 프로덕션과 동일하게 동작하도록 하기 위함이다.
 * - Android WebView: "; wv)" 토큰 + "Version/4.0"이 식별 포인트
 * - iOS WKWebView: Safari 브라우저와 달리 "Version/x Safari/x" 토큰이 없다
 * - Firefox: 대응되는 웹뷰가 없으므로 프리셋 유지
 */
export function buildWebviewUserAgent(
  engine: BrowserEngineName,
  presetUserAgent: string,
): string | undefined {
  if (engine === 'chromium') {
    const chromeVersion = /Chrome\/([\d.]+)/.exec(presetUserAgent)?.[1] ?? '131.0.0.0';
    return `Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/${chromeVersion} Mobile Safari/537.36`;
  }
  if (engine === 'webkit') {
    const webkitVersion = /AppleWebKit\/([\d.]+)/.exec(presetUserAgent)?.[1] ?? '605.1.15';
    return `Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/${webkitVersion} (KHTML, like Gecko) Mobile/15E148`;
  }
  return undefined;
}

const NAVIGATION_TIMEOUT_MS = 30_000;
// 네트워크 상세의 응답 바디 프리뷰 상한 (WS 페이로드 보호)
const BODY_PREVIEW_LIMIT = 16_000;
const SCREENSHOT_TIMEOUT_MS = 8_000;
// 풀페이지 캡처 상한 (CSS px) — 이보다 긴 페이지는 뷰포트 캡처로 폴백
const MAX_FULL_PAGE_CSS_PX = 5_000;
const JPEG_QUALITY = 60;
// 폴링 캡처 주기: 평소에는 낮게 유지하고(변화 없는 프레임은 어차피 스킵),
// 입력 직후 ACTIVITY_WINDOW_MS 동안은 빠르게 돌려 반응이 즉시 보이게 한다
const IDLE_CAPTURE_INTERVAL_MS = 400;
// 시청자 0명일 때의 폴링 간격 — setViewersActive(true)의 wake가 즉시 깨운다
const NO_VIEWER_SLEEP_MS = 60_000;
// 로그인 세션 주기 저장 — 강제 종료(kill)에도 세션이 남도록
const STATE_SAVE_INTERVAL_MS = 30_000;
const ACTIVE_CAPTURE_INTERVAL_MS = 16; // 활성 중 백투백 캡처 (스크린샷 소요가 실질 간격)
const ACTIVITY_WINDOW_MS = 2_000;

export class EngineSession implements InputTarget {
  private disposed = false;
  private activeUntil = 0;
  private wakeCapture: (() => void) | null = null;
  private lastFrame: Buffer | null = null;
  /** 시청자(대시보드 클라이언트) 유무 — 0명이면 캡처/스크린캐스트를 멈춘다 */
  private viewersActive = true;
  private cdpSession: import('playwright').CDPSession | null = null;
  private stateSaveTimer: NodeJS.Timeout | null = null;

  private constructor(
    readonly engine: BrowserEngineName,
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private readonly page: Page,
    private readonly viewport: Viewport,
    private readonly statePath: string,
  ) {}

  static async launch(
    engine: BrowserEngineName,
    options: SessionOptions,
    events: SessionEvents,
  ): Promise<EngineSession> {
    events.onStatus(engine, 'starting');
    const devicePreset = devices[options.device];
    if (!devicePreset) throw new Error(`Unknown device "${options.device}"`);

    const userAgent =
      options.customUserAgent ??
      (options.emulateWebview ? buildWebviewUserAgent(engine, devicePreset.userAgent) : undefined);

    // 주입 스크립트는 브라우저 spawn 전에 읽는다 — 잘못된 경로가
    // launch 후에 던지면 브라우저 프로세스가 고아로 남는다
    const injectScript = options.injectScriptPath
      ? await readFile(options.injectScriptPath, 'utf-8')
      : undefined;

    // Playwright의 기본 시그널 핸들러는 SIGINT/SIGTERM에서 브라우저를 즉시 닫아
    // 종료 시 세션 저장(storageState)이 실패한다 — 종료는 index.ts의 shutdown이 관리
    const browser = await launchers[engine].launch({
      handleSIGINT: false,
      handleSIGTERM: false,
    });
    const contextOptions = {
      ...devicePreset,
      // Firefox는 모바일 에뮬레이션(isMobile/hasTouch)을 지원하지 않아 옵션을 제거해야 launch가 성공한다
      ...(engine === 'firefox' ? { isMobile: false, hasTouch: false } : {}),
      ...(userAgent ? { userAgent } : {}),
      // 실제 WKWebView는 App-Bound Domains 설정 없이는 서비스워커를 지원하지 않는다
      ...(engine === 'webkit' && options.emulateWebview
        ? { serviceWorkers: 'block' as const }
        : {}),
    };
    const statePath = sessionStatePath(options.url, engine);
    const restoreState = !options.freshSession && existsSync(statePath);
    let context: BrowserContext;
    let page: Page;
    try {
      try {
        context = await browser.newContext({
          ...contextOptions,
          ...(restoreState ? { storageState: statePath } : {}),
        });
      } catch {
        // 저장된 상태 파일이 손상된 경우 — 깨끗하게 시작 (세션 파일은 종료 시 덮어써짐)
        context = await browser.newContext(contextOptions);
      }
      if (injectScript) await context.addInitScript({ content: injectScript });
      page = await context.newPage();
    } catch (err) {
      // 기동 중도 실패 시 브라우저를 반드시 닫는다 — handleSIGINT:false라
      // 여기서 안 닫으면 Ctrl-C로도 안 죽는 고아 프로세스가 남는다
      await browser.close().catch(() => undefined);
      throw err;
    }
    page.on('console', (msg) => events.onConsole(engine, msg.type(), msg.text()));
    page.on('pageerror', (err) => events.onPageError(engine, err.stack ?? err.message));
    page.on('requestfailed', (req) => {
      const errorText = req.failure()?.errorText ?? 'failed';
      if (isAbortedRequestError(errorText)) return;
      events.onRequestFailed(engine, req.url(), errorText);
    });
    // 실배포 웹뷰에서 터지는 문제 대부분은 API의 4xx/5xx 응답이다 —
    // 네트워크 레벨 실패(requestfailed)만으로는 잡히지 않으므로 별도 수집
    page.on('response', (response) => {
      if (response.status() >= 400) {
        events.onHttpError(engine, response.url(), response.status());
      }
      // 네트워크 패널: 전체 응답을 수집해 엔진 간 상태/속도를 비교한다.
      // durationMs는 응답 완료 시점에 확정되므로 finished를 기다린다
      const request = response.request();
      void response
        .finished()
        .catch(() => undefined)
        .then(async () => {
          const timing = request.timing();
          // 상세(헤더/바디)는 API 응답(xhr/fetch)에만 — 정적 리소스는 무겁고 무의미
          const isApi = request.resourceType() === 'xhr' || request.resourceType() === 'fetch';
          let bodyPreview: string | undefined;
          let bodyTruncated: boolean | undefined;
          if (isApi) {
            const contentType = response.headers()['content-type'] ?? '';
            if (/json|text|xml|urlencoded/.test(contentType)) {
              const body = await response.text().catch(() => undefined);
              if (body !== undefined) {
                bodyTruncated = body.length > BODY_PREVIEW_LIMIT;
                bodyPreview = body.slice(0, BODY_PREVIEW_LIMIT);
              }
            }
          }
          events.onNetwork(engine, {
            method: request.method(),
            url: response.url(),
            status: response.status(),
            resourceType: request.resourceType(),
            durationMs: timing.responseEnd >= 0 ? Math.round(timing.responseEnd) : -1,
            ...(isApi ? { responseHeaders: response.headers() } : {}),
            bodyPreview,
            bodyTruncated,
          });
        })
        // 내비게이션으로 요청이 파기된 뒤 timing()/headers()가 던질 수 있다 —
        // unhandled rejection(Node 기본: 프로세스 종료)이 되지 않게 삼킨다
        .catch(() => undefined);
    });
    let lastNavigatedUrl = '';
    page.on('framenavigated', (frame) => {
      // 메인 프레임만 추적 (iframe 내비게이션 제외), 같은 URL 중복 통지 방지
      if (frame !== page.mainFrame() || frame.url() === lastNavigatedUrl) return;
      lastNavigatedUrl = frame.url();
      events.onNavigation(engine, frame.url());
    });

    const session = new EngineSession(
      engine,
      browser,
      context,
      page,
      devicePreset.viewport,
      statePath,
    );
    try {
      await page.goto(options.url, {
        waitUntil: 'domcontentloaded',
        timeout: NAVIGATION_TIMEOUT_MS,
      });
      events.onStatus(engine, 'ready');
    } catch (err) {
      events.onStatus(engine, 'error', String(err));
    }
    await session.startFrameStreaming(events);
    session.startPeriodicStateSave();
    return session;
  }

  /**
   * 프레임 스트리밍 전략:
   * - Chromium: CDP screencast — 화면이 변할 때만 브라우저가 프레임을 밀어줘서
   *   폴링 없이 고프레임을 얻는다
   * - WebKit/Firefox: screencast API가 없어 적응형 폴링으로 대체.
   *   변화 없는 프레임은 전송을 생략하고, 입력 직후에는 주기를 올린다
   */
  private async startFrameStreaming(events: SessionEvents): Promise<void> {
    // 첫 화면을 즉시 보여주기 위한 시드 프레임
    await this.captureAndEmitFrame(events);
    if (this.engine === 'chromium') {
      try {
        await this.startCdpScreencast(events);
        return;
      } catch {
        // CDP를 열 수 없으면 폴링으로 폴백
      }
    }
    this.startAdaptivePolling(events);
  }

  private async startCdpScreencast(events: SessionEvents): Promise<void> {
    const cdp = await this.page.context().newCDPSession(this.page);
    this.cdpSession = cdp;
    cdp.on('Page.screencastFrame', (frame) => {
      if (!this.disposed) {
        // metadata.scrollOffsetY: 캡처 시점의 실제 스크롤 위치 — 로컬 에코 보정용
        events.onFrame(
          this.engine,
          Buffer.from(frame.data, 'base64'),
          Math.round(frame.metadata.scrollOffsetY ?? 0),
        );
      }
      // ack를 보내지 않으면 다음 프레임이 오지 않는다
      void cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
    });
    await this.sendStartScreencast(cdp);
  }

  private async sendStartScreencast(cdp: import('playwright').CDPSession): Promise<void> {
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: JPEG_QUALITY,
      // CSS 픽셀 크기로 제한 — 기기 DPR(예: iPhone 15는 3배) 그대로 보내면
      // 인코딩/전송/디코딩 비용이 9배가 된다
      maxWidth: this.viewport.width,
      maxHeight: this.viewport.height,
    });
  }

  private startAdaptivePolling(events: SessionEvents): void {
    void (async () => {
      while (!this.disposed) {
        const interval =
          Date.now() < this.activeUntil ? ACTIVE_CAPTURE_INTERVAL_MS : IDLE_CAPTURE_INTERVAL_MS;
        await this.sleepUntilWoken(this.viewersActive ? interval : NO_VIEWER_SLEEP_MS);
        if (this.disposed) break;
        // 보는 사람이 없으면 스크린샷을 아예 찍지 않는다 — 유휴 CPU 0에 수렴
        if (!this.viewersActive) continue;
        await this.captureAndEmitFrame(events);
      }
    })();
  }

  /** 대시보드 접속/이탈 — 0명이면 캡처(폴링/스크린캐스트)를 멈추고, 재접속 시 즉시 재개 */
  setViewersActive(active: boolean): void {
    if (this.viewersActive === active) return;
    this.viewersActive = active;
    if (this.engine === 'chromium' && this.cdpSession) {
      const cdp = this.cdpSession;
      void (active ? this.sendStartScreencast(cdp) : cdp.send('Page.stopScreencast')).catch(
        () => undefined,
      );
    }
    if (active) {
      this.lastFrame = null; // 재개 첫 프레임은 무조건 전송 (그동안의 변화 반영)
      this.wakeCapture?.();
    }
  }

  private async captureAndEmitFrame(events: SessionEvents): Promise<void> {
    try {
      // 캡처 직전의 스크롤 위치/페이지 높이/고정 크롬 유무 — 풀페이지 여부 판단 + 로컬 팬 보정용
      const [scrollY, pageHeight, pinnedChrome] = await this.page
        .evaluate(() => {
          // cli tsconfig에는 DOM lib가 없다 — 브라우저 컨텍스트 타입은 구조 타입으로 선언
          type El = { parentElement: El | null };
          const g = globalThis as unknown as {
            scrollY: number;
            innerWidth: number;
            innerHeight: number;
            document: {
              documentElement: { scrollHeight: number };
              elementFromPoint(x: number, y: number): El | null;
            };
            getComputedStyle(el: El): { position: string };
            __crosspaneScroller?: { scrollTop: number; isConnected: boolean } | null;
          };
          // 내부 컨테이너가 스크롤 중이면 그 기준으로 — 로컬 에코 정합
          const scroller = g.__crosspaneScroller;
          const scrollY = scroller?.isConnected ? scroller.scrollTop : g.scrollY;
          // 뷰포트 상/하단 가장자리에 fixed/sticky 요소(탭바·헤더)가 붙어 있는가 —
          // 풀페이지 캡처는 이들을 문서 위치로 찍어 스크롤 중 엉뚱한 곳에 보이게 한다.
          // 가장자리 두 점의 조상 체인만 보므로 프레임당 비용은 O(트리 깊이)다
          let pinned = false;
          for (const y of [8, g.innerHeight - 8]) {
            let el = g.document.elementFromPoint(g.innerWidth / 2, y);
            while (el) {
              const position = g.getComputedStyle(el).position;
              if (position === 'fixed' || position === 'sticky') {
                pinned = true;
                break;
              }
              el = el.parentElement;
            }
            if (pinned) break;
          }
          return [scrollY, g.document.documentElement.scrollHeight, pinned] as const;
        })
        .catch(() => [SCROLL_Y_UNKNOWN, 0, false] as const);
      // 폴링 엔진(WebKit/Firefox)의 이원 전략:
      // - 입력 활성 중: 풀페이지 프레임 → 대시보드가 로컬 크롭 팬 (스크롤 60fps, 빈 영역 0)
      // - 유휴: 뷰포트 프레임 → sticky/fixed 요소까지 정확한 실제 화면
      // 단, 가장자리에 고정 크롬이 있는 페이지는 풀페이지 팬이 탭바/헤더를 문서
      // 위치에 그려 스크롤 중 오배치가 보인다(실사용 보고) — 뷰포트 모드로 강등해
      // 정확성을 우선한다 (스크롤 체감은 로컬 에코가 담당)
      // 과도하게 긴 페이지는 캡처 비용 폭증 → 뷰포트 모드로 폴백
      const active = Date.now() < this.activeUntil;
      const fullPage =
        active && !pinnedChrome && pageHeight > 0 && pageHeight <= MAX_FULL_PAGE_CSS_PX;
      const jpeg = await this.page.screenshot({
        type: 'jpeg',
        quality: JPEG_QUALITY,
        scale: 'css', // DPR 배율 제거 — 위 startCdpScreencast의 maxWidth 주석 참고
        fullPage,
        timeout: SCREENSHOT_TIMEOUT_MS,
      });
      // 변화 없는 프레임은 전송하지 않는다 — 유휴 상태에서 트래픽이 0이 된다
      if (this.lastFrame?.equals(jpeg)) return;
      this.lastFrame = jpeg;
      events.onFrame(this.engine, jpeg, scrollY, fullPage ? FRAME_FLAG_FULL_PAGE : 0);
    } catch {
      // 내비게이션/리로드 중에는 스크린샷이 일시적으로 실패할 수 있다 — 루프는 유지
    }
  }

  private sleepUntilWoken(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.wakeCapture = null;
        resolve();
      }, ms);
      this.wakeCapture = () => {
        clearTimeout(timer);
        this.wakeCapture = null;
        resolve();
      };
    });
  }

  /** 입력이 발생했음을 알린다 — 대기 중인 폴링을 즉시 깨우고 잠시 고주기로 전환 */
  markActivity(): void {
    this.activeUntil = Date.now() + ACTIVITY_WINDOW_MS;
    this.wakeCapture?.();
  }

  /** 대시보드가 보내는 0~1 정규화 좌표를 실제 뷰포트 픽셀 좌표로 환산해 클릭한다 */
  async clickAt(normalizedX: number, normalizedY: number): Promise<void> {
    await this.page.mouse.click(
      normalizedX * this.viewport.width,
      normalizedY * this.viewport.height,
    );
  }

  async dragBetween(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    durationMs: number,
  ): Promise<void> {
    const deltaX = (toX - fromX) * this.viewport.width;
    const deltaY = (toY - fromY) * this.viewport.height;
    // 세로 위주 드래그 = 터치 스크롤 의도 — 마우스 드래그로 재생하면 모바일
    // 뷰포트에서 텍스트 선택이 돼버린다 (실측). 검증된 scrollBy 경로로 변환한다
    if (Math.abs(deltaY) > Math.abs(deltaX) * 1.5) {
      await this.scrollBy(-deltaY);
      return;
    }
    // 가로/자유 드래그(캐러셀·슬라이더)는 pointer 시퀀스로 재생 —
    // 중간 move를 여러 스텝으로 보내야 드래그로 인식하는 라이브러리가 많다
    const steps = Math.max(3, Math.min(12, Math.round(durationMs / 30)));
    await this.page.mouse.move(fromX * this.viewport.width, fromY * this.viewport.height);
    await this.page.mouse.down();
    await this.page.mouse.move(toX * this.viewport.width, toY * this.viewport.height, { steps });
    await this.page.mouse.up();
  }

  /**
   * mouse.wheel은 WebKit 모바일 컨텍스트에서 무시되고, 엔진마다 스크롤
   * 애니메이션 속도가 달라 위치가 어긋난다. 세 엔진이 항상 같은 픽셀만큼
   * 움직이도록 JS scrollBy를 주입해 즉시 스크롤한다.
   */
  async scrollBy(deltaY: number, normalizedX?: number, normalizedY?: number): Promise<void> {
    // 실무 앱은 window가 아니라 내부 컨테이너(overflow)가 스크롤하는 경우가 많다 —
    // 포인터 아래에서 실제 스크롤 가능한 조상을 찾아 스크롤한다 (window는 폴백).
    // 찾은 컨테이너는 전역에 마킹해 프레임 scrollY 리포트가 같은 기준을 쓰게 한다.
    await this.page.evaluate(
      ([dy, nx, ny]) => {
        type El = {
          scrollHeight: number;
          clientHeight: number;
          scrollTop: number;
          parentElement: El | null;
        };
        const g = globalThis as unknown as {
          innerWidth: number;
          innerHeight: number;
          scrollBy: (x: number, y: number) => void;
          document: {
            elementFromPoint(x: number, y: number): El | null;
            scrollingElement: El | null;
          };
          getComputedStyle: (el: El) => { overflowY: string };
          __crosspaneScroller?: El | null;
        };
        const findScroller = (): El | null => {
          if (nx === undefined || ny === undefined) return g.__crosspaneScroller ?? null;
          let el = g.document.elementFromPoint(nx * g.innerWidth, ny * g.innerHeight);
          while (el && el !== g.document.scrollingElement) {
            const style = g.getComputedStyle(el);
            if (
              (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
              el.scrollHeight > el.clientHeight + 1
            ) {
              return el;
            }
            el = el.parentElement;
          }
          return null;
        };
        const scroller = findScroller();
        g.__crosspaneScroller = scroller;
        if (scroller) scroller.scrollTop += dy as number;
        else g.scrollBy(0, dy as number);
      },
      [deltaY, normalizedX, normalizedY] as [number, number | undefined, number | undefined],
    );
  }

  async pressKey(key: string): Promise<void> {
    await this.page.keyboard.press(key);
  }

  async typeText(text: string): Promise<void> {
    await this.page.keyboard.type(text);
  }

  async goBack(): Promise<void> {
    // 히스토리가 없으면 null 반환 — 에러 아님
    await this.page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => null);
  }

  async goForward(): Promise<void> {
    await this.page.goForward({ waitUntil: 'domcontentloaded' }).catch(() => null);
  }

  async reload(): Promise<void> {
    await this.page.reload({ waitUntil: 'domcontentloaded' });
  }

  async navigate(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  /** 주기적 세션 저장 — SIGKILL 등 비정상 종료에도 로그인이 유실되지 않게 */
  startPeriodicStateSave(): void {
    this.stateSaveTimer = setInterval(() => {
      void this.saveState();
    }, STATE_SAVE_INTERVAL_MS);
  }

  private async saveState(): Promise<void> {
    try {
      mkdirSync(dirname(this.statePath), { recursive: true });
      await this.context.storageState({ path: this.statePath });
    } catch {
      // 세션 저장 실패는 동작을 막지 않는다 (내비게이션 중 등 일시적 실패)
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.stateSaveTimer) clearInterval(this.stateSaveTimer);
    this.wakeCapture?.();
    // 로그인 세션 유지: 쿠키/로컬스토리지를 저장해 다음 실행에서 복원한다
    await this.saveState();
    await this.browser.close().catch(() => undefined);
  }
}
