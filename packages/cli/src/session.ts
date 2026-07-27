import {
  chromium,
  webkit,
  firefox,
  devices,
  type Browser,
  type Page,
} from 'playwright';
import { readFile } from 'node:fs/promises';
import type { EngineName, LogLevel } from './protocol.js';

const launchers = { chromium, webkit, firefox } as const;

export interface SessionEvents {
  onFrame(engine: EngineName, jpegBase64: string): void;
  onConsole(engine: EngineName, level: LogLevel, text: string): void;
  onPageError(engine: EngineName, message: string): void;
  onRequestFailed(engine: EngineName, url: string, error: string): void;
  onStatus(engine: EngineName, status: 'starting' | 'ready' | 'error', detail?: string): void;
}

export interface SessionOptions {
  url: string;
  device: string;
  fps: number;
  injectScriptPath?: string;
}

export function resolveDevice(name: string): { width: number; height: number } {
  const preset = devices[name];
  if (!preset) {
    const known = Object.keys(devices)
      .filter((d) => /iPhone|Pixel|Galaxy|iPad/.test(d))
      .slice(0, 20)
      .join(', ');
    throw new Error(`Unknown device "${name}". Examples: ${known}`);
  }
  return { width: preset.viewport.width, height: preset.viewport.height };
}

export class EngineSession {
  private closed = false;
  private capturing = false;

  private constructor(
    readonly engine: EngineName,
    private readonly browser: Browser,
    private readonly page: Page,
    private readonly viewport: { width: number; height: number },
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
      // Firefox rejects mobile emulation options
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
      await page.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      events.onStatus(engine, 'ready');
    } catch (err) {
      events.onStatus(engine, 'error', String(err));
    }
    session.startCaptureLoop(opts.fps, events);
    return session;
  }

  private startCaptureLoop(fps: number, events: SessionEvents): void {
    const interval = Math.max(1000 / fps, 100);
    this.capturing = true;
    void (async () => {
      while (!this.closed) {
        const started = Date.now();
        try {
          const buf = await this.page.screenshot({ type: 'jpeg', quality: 60, timeout: 5_000 });
          events.onFrame(this.engine, buf.toString('base64'));
        } catch {
          // Transient during navigation/reload — keep the loop alive.
        }
        const elapsed = Date.now() - started;
        await new Promise((r) => setTimeout(r, Math.max(interval - elapsed, 50)));
      }
    })();
  }

  async click(nx: number, ny: number): Promise<void> {
    await this.page.mouse.click(nx * this.viewport.width, ny * this.viewport.height);
  }

  async scroll(deltaY: number): Promise<void> {
    await this.page.mouse.wheel(0, deltaY);
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
    await this.browser.close().catch(() => {});
  }
}
