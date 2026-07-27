import { readFile } from 'node:fs/promises';
import { type Browser, chromium, devices, firefox, type Page, webkit } from 'playwright';
import type { Viewport } from './devices.js';
import type { EngineName, EngineStatus, LogLevel } from './protocol.js';

const launchers = { chromium, webkit, firefox } as const;

export interface SessionEvents {
  onFrame(engine: EngineName, jpeg: Buffer): void;
  onConsole(engine: EngineName, level: LogLevel, text: string): void;
  onPageError(engine: EngineName, message: string): void;
  onRequestFailed(engine: EngineName, url: string, error: string): void;
  onHttpError(engine: EngineName, url: string, status: number): void;
  onStatus(engine: EngineName, status: EngineStatus, detail?: string): void;
  onNavigation(engine: EngineName, url: string): void;
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
}

const NAVIGATION_TIMEOUT_MS = 30_000;
const SCREENSHOT_TIMEOUT_MS = 5_000;
const JPEG_QUALITY = 60;
// 폴링 캡처 주기: 평소에는 낮게 유지하고(변화 없는 프레임은 어차피 스킵),
// 입력 직후 ACTIVITY_WINDOW_MS 동안은 빠르게 돌려 반응이 즉시 보이게 한다
const IDLE_CAPTURE_INTERVAL_MS = 400;
const ACTIVE_CAPTURE_INTERVAL_MS = 120;
const ACTIVITY_WINDOW_MS = 2_000;

export class EngineSession {
  private disposed = false;
  private activeUntil = 0;
  private wakeCapture: (() => void) | null = null;
  private lastFrame: Buffer | null = null;

  private constructor(
    readonly engine: EngineName,
    private readonly browser: Browser,
    private readonly page: Page,
    private readonly viewport: Viewport,
  ) {}

  static async launch(
    engine: EngineName,
    options: SessionOptions,
    events: SessionEvents,
  ): Promise<EngineSession> {
    events.onStatus(engine, 'starting');
    const devicePreset = devices[options.device];
    if (!devicePreset) throw new Error(`Unknown device "${options.device}"`);

    const browser = await launchers[engine].launch();
    const context = await browser.newContext({
      ...devicePreset,
      // Firefox는 모바일 에뮬레이션(isMobile/hasTouch)을 지원하지 않아 옵션을 제거해야 launch가 성공한다
      ...(engine === 'firefox' ? { isMobile: false, hasTouch: false } : {}),
    });

    if (options.injectScriptPath) {
      const script = await readFile(options.injectScriptPath, 'utf-8');
      await context.addInitScript({ content: script });
    }

    const page = await context.newPage();
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
    });
    let lastNavigatedUrl = '';
    page.on('framenavigated', (frame) => {
      // 메인 프레임만 추적 (iframe 내비게이션 제외), 같은 URL 중복 통지 방지
      if (frame !== page.mainFrame() || frame.url() === lastNavigatedUrl) return;
      lastNavigatedUrl = frame.url();
      events.onNavigation(engine, frame.url());
    });

    const session = new EngineSession(engine, browser, page, devicePreset.viewport);
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
    cdp.on('Page.screencastFrame', (frame) => {
      if (!this.disposed) events.onFrame(this.engine, Buffer.from(frame.data, 'base64'));
      // ack를 보내지 않으면 다음 프레임이 오지 않는다
      void cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
    });
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
        await this.sleepUntilWoken(interval);
        if (this.disposed) break;
        await this.captureAndEmitFrame(events);
      }
    })();
  }

  private async captureAndEmitFrame(events: SessionEvents): Promise<void> {
    try {
      const jpeg = await this.page.screenshot({
        type: 'jpeg',
        quality: JPEG_QUALITY,
        scale: 'css', // DPR 배율 제거 — 위 startCdpScreencast의 maxWidth 주석 참고
        timeout: SCREENSHOT_TIMEOUT_MS,
      });
      // 변화 없는 프레임은 전송하지 않는다 — 유휴 상태에서 트래픽이 0이 된다
      if (this.lastFrame?.equals(jpeg)) return;
      this.lastFrame = jpeg;
      events.onFrame(this.engine, jpeg);
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

  /**
   * mouse.wheel은 WebKit 모바일 컨텍스트에서 무시되고, 엔진마다 스크롤
   * 애니메이션 속도가 달라 위치가 어긋난다. 세 엔진이 항상 같은 픽셀만큼
   * 움직이도록 JS scrollBy를 주입해 즉시 스크롤한다.
   */
  async scrollBy(deltaY: number): Promise<void> {
    await this.page.evaluate((dy) => {
      (globalThis as unknown as { scrollBy: (x: number, y: number) => void }).scrollBy(0, dy);
    }, deltaY);
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

  async dispose(): Promise<void> {
    this.disposed = true;
    this.wakeCapture?.();
    await this.browser.close().catch(() => undefined);
  }
}
