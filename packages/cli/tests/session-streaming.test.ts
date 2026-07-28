import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserEngineName } from '../src/protocol';
import { EngineSession, type SessionEvents } from '../src/session';

/**
 * EngineSession의 프레임 스트리밍 전략(CDP 성공/실패 폴백, 변화 감지)을
 * 실제 브라우저 없이 검증한다. 생성자는 private이지만 런타임에는 강제성이
 * 없으므로 최소 표면의 가짜 browser/context/page를 주입한다.
 */

type CdpHandler = (frame: {
  data: string;
  metadata: { scrollOffsetY?: number };
  sessionId: number;
}) => void;

function fakeCdpSession() {
  const handlers = new Map<string, CdpHandler>();
  return {
    handlers,
    send: vi.fn(async () => {}),
    on: vi.fn((event: string, handler: CdpHandler) => {
      handlers.set(event, handler);
    }),
  };
}

function fakeEvents(): SessionEvents {
  return {
    onFrame: vi.fn(),
    onConsole: vi.fn(),
    onPageError: vi.fn(),
    onRequestFailed: vi.fn(),
    onHttpError: vi.fn(),
    onNetwork: vi.fn(),
    onStatus: vi.fn(),
    onNavigation: vi.fn(),
  };
}

interface FakeSessionOptions {
  engine?: BrowserEngineName;
  newCDPSession?: () => Promise<unknown>;
  screenshot?: () => Promise<Buffer>;
}

/** private 생성자·메서드는 컴파일 타임 제약뿐이라 구조 캐스트로 직접 구동한다 */
interface TestableSession extends EngineSession {
  startFrameStreaming(events: SessionEvents): Promise<void>;
}

function createSession(options: FakeSessionOptions = {}): TestableSession {
  let frameCounter = 0;
  const page = {
    context: () => ({
      newCDPSession:
        options.newCDPSession ??
        (async () => {
          throw new Error('CDP unavailable');
        }),
    }),
    evaluate: async () => [0, 1000, false] as const,
    screenshot:
      options.screenshot ??
      (async () => {
        frameCounter += 1;
        return Buffer.from(`jpeg-${frameCounter}`);
      }),
  };
  const browser = { close: vi.fn(async () => {}) };
  const context = { storageState: vi.fn(async () => ({})) };
  const Ctor = EngineSession as unknown as new (
    engine: BrowserEngineName,
    browser: unknown,
    context: unknown,
    page: unknown,
    viewport: { width: number; height: number },
    statePath: string,
  ) => TestableSession;
  return new Ctor(
    options.engine ?? 'chromium',
    browser,
    context,
    page,
    { width: 390, height: 844 },
    '/tmp/crosspane-test-state.json',
  );
}

describe('EngineSession 프레임 스트리밍', () => {
  const sessions: TestableSession[] = [];
  afterEach(async () => {
    await Promise.all(sessions.map((session) => session.dispose()));
    sessions.length = 0;
  });

  it('chromium: CDP screencast를 시작하고 수신 프레임마다 ack를 보낸다', async () => {
    const cdp = fakeCdpSession();
    const session = createSession({ newCDPSession: async () => cdp });
    sessions.push(session);
    const events = fakeEvents();

    await session.startFrameStreaming(events);
    expect(cdp.send).toHaveBeenCalledWith(
      'Page.startScreencast',
      expect.objectContaining({ maxWidth: 390, maxHeight: 844 }),
    );

    const jpeg = Buffer.from('cdp-frame');
    cdp.handlers.get('Page.screencastFrame')?.({
      data: jpeg.toString('base64'),
      metadata: { scrollOffsetY: 42.4 },
      sessionId: 7,
    });
    expect(events.onFrame).toHaveBeenCalledWith('chromium', jpeg, 42);
    expect(cdp.send).toHaveBeenCalledWith('Page.screencastFrameAck', { sessionId: 7 });
  });

  it('chromium: CDP를 열 수 없으면 폴링으로 폴백해 프레임을 계속 보낸다', async () => {
    const session = createSession(); // newCDPSession이 던진다
    sessions.push(session);
    const events = fakeEvents();

    await session.startFrameStreaming(events);
    // 시드 프레임(폴백 여부와 무관) + 폴링 루프의 후속 캡처
    expect(events.onFrame).toHaveBeenCalledTimes(1);

    session.markActivity(); // 활동 → 대기 중 sleep을 깨워 즉시 캡처
    await vi.waitFor(() => {
      expect(vi.mocked(events.onFrame).mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('폴링: 내용이 같은 프레임은 재전송하지 않는다 (유휴 트래픽 0 계약)', async () => {
    const sameJpeg = Buffer.from('identical');
    const session = createSession({ screenshot: async () => sameJpeg });
    sessions.push(session);
    const events = fakeEvents();

    await session.startFrameStreaming(events);
    session.markActivity();
    // 폴링이 몇 차례 돌 시간을 줘도 동일 프레임은 1회만 전송돼야 한다
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(events.onFrame).toHaveBeenCalledTimes(1);
  });

  it('setViewersActive: 시청자 0명이면 screencast를 멈추고 복귀 시 재시작한다', async () => {
    const cdp = fakeCdpSession();
    const session = createSession({ newCDPSession: async () => cdp });
    sessions.push(session);
    await session.startFrameStreaming(fakeEvents());
    cdp.send.mockClear();

    session.setViewersActive(false);
    expect(cdp.send).toHaveBeenCalledWith('Page.stopScreencast');

    session.setViewersActive(true);
    expect(cdp.send).toHaveBeenCalledWith(
      'Page.startScreencast',
      expect.objectContaining({ maxWidth: 390 }),
    );
  });
});
