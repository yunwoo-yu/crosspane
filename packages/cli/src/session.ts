import { readFile } from 'node:fs/promises';
import { type Browser, chromium, devices, firefox, type Page, webkit } from 'playwright';
import type { Viewport } from './devices.js';
import type { EngineName, EngineStatus, LogLevel } from './protocol.js';

const launchers = { chromium, webkit, firefox } as const;

export interface SessionEvents {
  onFrame(engine: EngineName, jpegBase64: string): void;
  onConsole(engine: EngineName, level: LogLevel, text: string): void;
  onPageError(engine: EngineName, message: string): void;
  onRequestFailed(engine: EngineName, url: string, error: string): void;
  onStatus(engine: EngineName, status: EngineStatus, detail?: string): void;
}

export interface SessionOptions {
  url: string;
  device: string;
  fps: number;
  injectScriptPath?: string;
}

const NAVIGATION_TIMEOUT_MS = 30_000;
const SCREENSHOT_TIMEOUT_MS = 5_000;
const MIN_FRAME_INTERVAL_MS = 100;
const MIN_IDLE_MS = 50;
// 입력 직후에는 이 간격(≈10fps)으로 캡처해서 반응이 빨리 보이게 한다
const BOOST_INTERVAL_MS = 100;
const BOOST_DURATION_MS = 1_500;

export class EngineSession {
  private closed = false;
  private boostUntil = 0;

  private constructor(
    readonly engine: EngineName,
    private readonly browser: Browser,
    private readonly page: Page,
    private readonly viewport: Viewport,
  ) {}

  static async create(
    engine: EngineName,
    opts: SessionOptions,
    events: SessionEvents,
  ): Promise<EngineSession> {
    events.onStatus(engine, 'starting');
    const preset = devices[opts.device];
    if (!preset) throw new Error(`Unknown device "${opts.device}"`);

    const browser = await launchers[engine].launch();
    const context = await browser.newContext({
      ...preset,
      // Firefox는 모바일 에뮬레이션(isMobile/hasTouch)을 지원하지 않아 옵션을 제거해야 launch가 성공한다
      ...(engine === 'firefox' ? { isMobile: false, hasTouch: false } : {}),
    });

    if (opts.injectScriptPath) {
      const script = await readFile(opts.injectScriptPath, 'utf-8');
      await context.addInitScript({ content: script });
    }

    const page = await context.newPage();
    page.on('console', (msg) => events.onConsole(engine, msg.type(), msg.text()));
    page.on('pageerror', (err) => events.onPageError(engine, err.stack ?? err.message));
    page.on('requestfailed', (req) =>
      events.onRequestFailed(engine, req.url(), req.failure()?.errorText ?? 'failed'),
    );

    const session = new EngineSession(engine, browser, page, preset.viewport);
    try {
      await page.goto(opts.url, {
        waitUntil: 'domcontentloaded',
        timeout: NAVIGATION_TIMEOUT_MS,
      });
      events.onStatus(engine, 'ready');
    } catch (err) {
      events.onStatus(engine, 'error', String(err));
    }
    session.startCaptureLoop(opts.fps, events);
    return session;
  }

  /**
   * 프레임 캡처 루프. WebKit/Firefox는 CDP screencast 같은 스트리밍 API가 없어서
   * screenshot() 폴링이 세 엔진을 동일하게 다룰 수 있는 유일한 방법이다.
   * 캡처가 밀려도 겹치지 않도록 setInterval 대신 순차 루프를 쓰고,
   * 캡처 소요 시간을 빼서 목표 fps에 맞춘다.
   */
  private startCaptureLoop(fps: number, events: SessionEvents): void {
    const interval = Math.max(1000 / fps, MIN_FRAME_INTERVAL_MS);
    void (async () => {
      while (!this.closed) {
        const started = Date.now();
        try {
          const buf = await this.page.screenshot({
            type: 'jpeg',
            quality: 60,
            timeout: SCREENSHOT_TIMEOUT_MS,
          });
          events.onFrame(this.engine, buf.toString('base64'));
        } catch {
          // 내비게이션/리로드 중에는 스크린샷이 일시적으로 실패할 수 있다 — 루프는 유지
        }
        const elapsed = Date.now() - started;
        const target = Date.now() < this.boostUntil ? BOOST_INTERVAL_MS : interval;
        await new Promise((r) => setTimeout(r, Math.max(target - elapsed, MIN_IDLE_MS)));
      }
    })();
  }

  /** 입력 직후 일정 시간 캡처 주기를 올린다 (평소에는 저fps로 리소스 절약) */
  boost(): void {
    this.boostUntil = Date.now() + BOOST_DURATION_MS;
  }

  /** 대시보드가 보내는 0~1 정규화 좌표를 실제 뷰포트 픽셀 좌표로 환산해 클릭한다 */
  async click(nx: number, ny: number): Promise<void> {
    await this.page.mouse.click(nx * this.viewport.width, ny * this.viewport.height);
  }

  /**
   * mouse.wheel은 WebKit 모바일 컨텍스트에서 무시되고, 엔진마다 스크롤
   * 애니메이션 속도가 달라 위치가 어긋난다. 세 엔진이 항상 같은 픽셀만큼
   * 움직이도록 JS scrollBy를 주입해 즉시 스크롤한다.
   */
  async scroll(deltaY: number): Promise<void> {
    await this.page.evaluate((dy) => {
      (globalThis as unknown as { scrollBy: (x: number, y: number) => void }).scrollBy(0, dy);
    }, deltaY);
  }

  async keypress(key: string): Promise<void> {
    await this.page.keyboard.press(key);
  }

  async reload(): Promise<void> {
    await this.page.reload({ waitUntil: 'domcontentloaded' });
  }

  async navigate(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.browser.close().catch(() => undefined);
  }
}
