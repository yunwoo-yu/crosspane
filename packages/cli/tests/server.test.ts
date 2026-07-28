import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { ENGINE_CODES, type EngineName, type HelloEvent, type ServerEvent } from '../src/protocol';
import { type DashboardServer, type PaneController, startDashboardServer } from '../src/server';
import type { EngineSession, InputTarget } from '../src/session';

/** 실제 브라우저 없이 입력 미러링을 검증하기 위한 EngineSession 대역 */
function fakeSession() {
  return {
    clickAt: vi.fn(async () => {}),
    dragBetween: vi.fn(async () => {}),
    scrollBy: vi.fn(async () => {}),
    pressKey: vi.fn(async () => {}),
    typeText: vi.fn(async () => {}),
    goBack: vi.fn(async () => {}),
    goForward: vi.fn(async () => {}),
    reload: vi.fn(async () => {}),
    navigate: vi.fn(async () => {}),
    markActivity: vi.fn(),
  };
}

function fakeController(): PaneController & { startEngine: ReturnType<typeof vi.fn> } {
  return { startEngine: vi.fn(async () => {}), stopEngine: vi.fn(async () => {}) };
}

const hello = (): HelloEvent => ({
  type: 'hello',
  url: 'http://localhost:3000',
  device: 'iPhone 15',
  engines: ['chromium'] as EngineName[],
  viewport: { width: 390, height: 844 },
});

type ReceivedMessage = { kind: 'event'; event: ServerEvent } | { kind: 'binary'; data: Buffer };

/**
 * 서버가 보내는 메시지(hello 등)는 핸드셰이크 직후 open과 같은 틱에 도착할 수 있어
 * open 이후에 리스너를 붙이면 놓친다. 연결 시점에 리스너를 붙이고 큐에 쌓아둔다.
 */
class TestClient {
  private readonly queue: ReceivedMessage[] = [];
  private readonly waiters: ((msg: ReceivedMessage) => void)[] = [];

  private constructor(readonly ws: WebSocket) {
    ws.on('message', (raw, isBinary) => {
      const message: ReceivedMessage = isBinary
        ? { kind: 'binary', data: raw as Buffer }
        : { kind: 'event', event: JSON.parse(String(raw)) as ServerEvent };
      const waiter = this.waiters.shift();
      if (waiter) waiter(message);
      else this.queue.push(message);
    });
  }

  static connect(port: number): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      const client = new TestClient(ws);
      ws.once('open', () => resolve(client));
      ws.once('error', reject);
    });
  }

  next(): Promise<ReceivedMessage> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  async nextEvent(): Promise<ServerEvent> {
    const message = await this.next();
    if (message.kind !== 'event') throw new Error('expected JSON event, got binary');
    return message.event;
  }

  async nextBinary(): Promise<Buffer> {
    const message = await this.next();
    if (message.kind !== 'binary') throw new Error('expected binary, got JSON event');
    return message.data;
  }

  sendCommand(command: unknown): void {
    this.ws.send(JSON.stringify(command));
  }
}

describe('startDashboardServer', () => {
  let server: DashboardServer | undefined;
  const clients: TestClient[] = [];

  afterEach(() => {
    for (const client of clients) client.ws.terminate();
    clients.length = 0;
    server?.close();
    server = undefined;
    vi.unstubAllEnvs();
  });

  it('포트가 사용 중이면 portAttempts 범위에서 +1 폴백한다', async () => {
    const blocker = await startDashboardServer({
      port: 0,
      hello,
      sessions: new Map(),
      paneController: fakeController(),
    });
    try {
      server = await startDashboardServer({
        port: blocker.port,
        portAttempts: 5,
        hello,
        sessions: new Map(),
        paneController: fakeController(),
      });
      expect(server.port).toBe(blocker.port + 1);
    } finally {
      blocker.close();
    }
  });

  it('portAttempts 없이 포트가 사용 중이면 명확한 에러를 던진다', async () => {
    const blocker = await startDashboardServer({
      port: 0,
      hello,
      sessions: new Map(),
      paneController: fakeController(),
    });
    try {
      await expect(
        startDashboardServer({
          port: blocker.port,
          hello,
          sessions: new Map(),
          paneController: fakeController(),
        }),
      ).rejects.toThrow(/already in use/);
    } finally {
      blocker.close();
    }
  });

  it('셸 프레임 POST가 브릿지로 전달되고 scrollY 쿼리를 파싱한다', async () => {
    const handleFrame = vi.fn();
    server = await startDashboardServer({
      port: 0,
      hello,
      sessions: new Map(),
      paneController: fakeController(),
      shellBridge: {
        waitForCommands: async () => [],
        handleEvent: () => {},
        handleFrame,
      },
    });
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xee]);
    const response = await fetch(
      `http://localhost:${server.port}/shell/ios-sim/frame?scrollY=372`,
      {
        method: 'POST',
        body: jpeg,
      },
    );
    expect(response.status).toBe(204);
    expect(handleFrame).toHaveBeenCalledWith('ios-sim', jpeg, 372);

    // scrollY 없으면 -1 (미상)
    await fetch(`http://localhost:${server.port}/shell/ios-sim/frame`, {
      method: 'POST',
      body: jpeg,
    });
    expect(handleFrame).toHaveBeenLastCalledWith('ios-sim', jpeg, -1);
  });

  it('watch 신호로 시청 엔진 합집합을 통지한다 (0명 = 빈 집합)', async () => {
    const snapshots: string[][] = [];
    server = await startDashboardServer({
      port: 0,
      hello,
      sessions: new Map(),
      paneController: fakeController(),
      onWatchedEnginesChange: (watched) => snapshots.push([...watched].sort()),
    });
    const client = await TestClient.connect(server.port);
    // watch 미전송 클라이언트는 전체 시청으로 간주된다
    await vi.waitFor(() => expect(snapshots.at(-1)).toContain('chromium'));

    client.sendCommand({ type: 'watch', engines: ['webkit'] });
    await vi.waitFor(() => expect(snapshots.at(-1)).toEqual(['webkit']));

    client.ws.close();
    await vi.waitFor(() => expect(snapshots.at(-1)).toEqual([]));
  });

  it('접속하면 hello를 먼저 보낸다', async () => {
    server = await startDashboardServer({
      port: 0,
      hello,
      sessions: new Map(),
      paneController: fakeController(),
    });
    const client = await TestClient.connect(server.port);
    clients.push(client);
    expect(await client.nextEvent()).toMatchObject({ type: 'hello', device: 'iPhone 15' });
  });

  it('입력 커맨드가 모든 세션에 미러링된다', async () => {
    const a = fakeSession();
    const b = fakeSession();
    const sessions = new Map([
      ['chromium', a as unknown as EngineSession],
      ['webkit', b as unknown as EngineSession],
    ] as [EngineName, EngineSession][]);
    server = await startDashboardServer({
      port: 0,
      hello,
      sessions,
      paneController: fakeController(),
    });
    const client = await TestClient.connect(server.port);
    clients.push(client);

    client.sendCommand({ type: 'click', x: 0.5, y: 0.25 });
    await vi.waitFor(() => {
      expect(a.clickAt).toHaveBeenCalledWith(0.5, 0.25);
      expect(b.clickAt).toHaveBeenCalledWith(0.5, 0.25);
    });

    client.sendCommand({
      type: 'drag',
      fromX: 0.5,
      fromY: 0.8,
      toX: 0.5,
      toY: 0.2,
      durationMs: 200,
    });
    await vi.waitFor(() => {
      expect(a.dragBetween).toHaveBeenCalledWith(0.5, 0.8, 0.5, 0.2, 200);
      expect(b.dragBetween).toHaveBeenCalledWith(0.5, 0.8, 0.5, 0.2, 200);
    });

    // engine 지정 스크롤은 그 세션에만 (pane 독립 스크롤)
    client.sendCommand({ type: 'scroll', deltaY: 55, engine: 'webkit' });
    await vi.waitFor(() => {
      expect(b.scrollBy).toHaveBeenCalledWith(55, undefined, undefined);
    });
    expect(a.scrollBy).not.toHaveBeenCalledWith(55, undefined, undefined);

    client.sendCommand({ type: 'scroll', deltaY: 120, x: 0.5, y: 0.4 });
    await vi.waitFor(() => {
      expect(a.scrollBy).toHaveBeenCalledWith(120, 0.5, 0.4);
      expect(b.scrollBy).toHaveBeenCalledWith(120, 0.5, 0.4);
      expect(a.markActivity).toHaveBeenCalled();
    });

    client.sendCommand({ type: 'type', text: 'hello' });
    client.sendCommand({ type: 'back' });
    client.sendCommand({ type: 'forward' });
    await vi.waitFor(() => {
      expect(a.typeText).toHaveBeenCalledWith('hello');
      expect(a.goBack).toHaveBeenCalled();
      expect(a.goForward).toHaveBeenCalled();
    });
  });

  it('잘못된 JSON을 받아도 죽지 않고 다음 커맨드를 처리한다', async () => {
    const a = fakeSession();
    const sessions = new Map([['chromium', a as unknown as EngineSession]] as [
      EngineName,
      EngineSession,
    ][]);
    server = await startDashboardServer({
      port: 0,
      hello,
      sessions,
      paneController: fakeController(),
    });
    const client = await TestClient.connect(server.port);
    clients.push(client);

    client.ws.send('not-json{{{');
    client.sendCommand({ type: 'reload' });
    await vi.waitFor(() => {
      expect(a.reload).toHaveBeenCalled();
    });
  });

  it('broadcastEvent가 연결된 모든 클라이언트에 전달된다', async () => {
    server = await startDashboardServer({
      port: 0,
      hello,
      sessions: new Map(),
      paneController: fakeController(),
    });
    const c1 = await TestClient.connect(server.port);
    const c2 = await TestClient.connect(server.port);
    clients.push(c1, c2);
    await Promise.all([c1.nextEvent(), c2.nextEvent()]); // hello 소비

    const received = Promise.all([c1.nextEvent(), c2.nextEvent()]);
    server.broadcastEvent({ type: 'engine-status', engine: 'chromium', status: 'ready' });
    const [m1, m2] = await received;
    expect(m1).toEqual({ type: 'engine-status', engine: 'chromium', status: 'ready' });
    expect(m2).toEqual(m1);
  });

  it('broadcastFrame이 [엔진코드 1바이트][JPEG] 바이너리 패킷으로 전달된다', async () => {
    server = await startDashboardServer({
      port: 0,
      hello,
      sessions: new Map(),
      paneController: fakeController(),
    });
    const client = await TestClient.connect(server.port);
    clients.push(client);
    await client.nextEvent(); // hello 소비

    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    server.broadcastFrame('webkit', jpeg, 480);
    const packet = await client.nextBinary();
    expect(packet[1]).toBe(ENGINE_CODES.webkit);
    expect(packet.readInt32LE(3)).toBe(480); // 로컬 에코 보정용 scrollY
    expect(packet.subarray(7)).toEqual(jpeg);
  });

  it('마지막 프레임을 새 클라이언트에 재전송한다', async () => {
    server = await startDashboardServer({
      port: 0,
      hello,
      sessions: new Map(),
      paneController: fakeController(),
    });
    // 클라이언트가 없을 때 프레임 발생 — 화면 변화가 없으면 다시 오지 않는다
    server.broadcastFrame('chromium', Buffer.from([1, 2, 3]), 0);

    const client = await TestClient.connect(server.port);
    clients.push(client);
    await client.nextEvent(); // hello 소비
    const packet = await client.nextBinary();
    expect(packet[1]).toBe(ENGINE_CODES.chromium);
    expect(packet.subarray(7)).toEqual(Buffer.from([1, 2, 3]));
  });

  it('접속 전에 발생한 로그를 새 클라이언트에 재전송한다', async () => {
    server = await startDashboardServer({
      port: 0,
      hello,
      sessions: new Map(),
      paneController: fakeController(),
    });
    // 클라이언트가 없을 때 발생한 이벤트
    server.broadcastEvent({
      type: 'console',
      engine: 'chromium',
      level: 'log',
      text: 'early-log',
      ts: 1,
    });
    server.broadcastEvent({ type: 'engine-status', engine: 'chromium', status: 'ready' });

    const client = await TestClient.connect(server.port);
    clients.push(client);
    expect(await client.nextEvent()).toMatchObject({ type: 'hello' });
    expect(await client.nextEvent()).toMatchObject({ type: 'engine-status', status: 'ready' });
    expect(await client.nextEvent()).toMatchObject({ type: 'console', text: 'early-log' });
  });

  it('마지막 내비게이션을 히스토리 로그 뒤에 재전송한다 (배지 오염 방지)', async () => {
    server = await startDashboardServer({
      port: 0,
      hello,
      sessions: new Map(),
      paneController: fakeController(),
    });
    server.broadcastEvent({ type: 'navigation', engine: 'chromium', url: 'http://a/1', ts: 1 });
    server.broadcastEvent({
      type: 'pageerror',
      engine: 'chromium',
      message: 'old error',
      ts: 2,
    });
    server.broadcastEvent({ type: 'navigation', engine: 'chromium', url: 'http://a/2', ts: 3 });

    const client = await TestClient.connect(server.port);
    clients.push(client);
    expect(await client.nextEvent()).toMatchObject({ type: 'hello' });
    expect(await client.nextEvent()).toMatchObject({ type: 'pageerror' });
    // 마지막 내비게이션이 과거 에러 로그 뒤에 와야 새 클라이언트 배지가 0에서 시작한다
    expect(await client.nextEvent()).toMatchObject({ type: 'navigation', url: 'http://a/2' });
  });

  it('start/stop-engine 커맨드는 미러링이 아니라 컨트롤러로 라우팅된다', async () => {
    const controller = fakeController();
    const session = fakeSession();
    const sessions = new Map([['chromium', session as unknown as InputTarget]] as [
      EngineName,
      InputTarget,
    ][]);
    server = await startDashboardServer({ port: 0, hello, sessions, paneController: controller });
    const client = await TestClient.connect(server.port);
    clients.push(client);

    client.sendCommand({ type: 'start-engine', engine: 'firefox' });
    client.sendCommand({ type: 'stop-engine', engine: 'chromium' });
    await vi.waitFor(() => {
      expect(controller.startEngine).toHaveBeenCalledWith('firefox');
      expect(controller.stopEngine).toHaveBeenCalledWith('chromium');
    });
    // 세션 입력으로 흘러가지 않는다
    expect(session.clickAt).not.toHaveBeenCalled();
  });

  it('엔진이 stopped되면 캐시된 프레임을 새 클라이언트에 재생하지 않는다', async () => {
    server = await startDashboardServer({
      port: 0,
      hello,
      sessions: new Map(),
      paneController: fakeController(),
    });
    server.broadcastFrame('chromium', Buffer.from([1, 2, 3]), 0);
    server.broadcastEvent({ type: 'engine-status', engine: 'chromium', status: 'stopped' });

    const client = await TestClient.connect(server.port);
    clients.push(client);
    expect(await client.nextEvent()).toMatchObject({ type: 'hello' });
    expect(await client.nextEvent()).toMatchObject({ type: 'engine-status', status: 'stopped' });
    // 다음 메시지가 프레임이면 실패해야 한다 — 짧게 기다려 프레임이 안 오는 것을 확인
    const raced = await Promise.race([
      client.next().then(() => 'message'),
      new Promise((resolve) => setTimeout(() => resolve('silence'), 400)),
    ]);
    expect(raced).toBe('silence');
  });

  it('network 이벤트도 히스토리로 재전송된다 (별도 버퍼)', async () => {
    server = await startDashboardServer({
      port: 0,
      hello,
      sessions: new Map(),
      paneController: fakeController(),
    });
    server.broadcastEvent({
      type: 'network',
      engine: 'chromium',
      method: 'GET',
      url: 'http://a/api',
      status: 200,
      resourceType: 'fetch',
      durationMs: 5,
      ts: 1,
    });

    const client = await TestClient.connect(server.port);
    clients.push(client);
    expect(await client.nextEvent()).toMatchObject({ type: 'hello' });
    expect(await client.nextEvent()).toMatchObject({ type: 'network', status: 200 });
  });

  it('사용 중인 포트면 명확한 에러로 실패한다', async () => {
    server = await startDashboardServer({
      port: 0,
      hello,
      sessions: new Map(),
      paneController: fakeController(),
    });
    await expect(
      startDashboardServer({
        port: server.port,
        hello,
        sessions: new Map(),
        paneController: fakeController(),
      }),
    ).rejects.toThrow(/already in use/);
  });

  it('CROSSPANE_DASHBOARD_DIR로 대시보드 정적 파일을 서빙한다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'crosspane-dash-'));
    writeFileSync(join(dir, 'index.html'), '<html>test-dashboard</html>');
    vi.stubEnv('CROSSPANE_DASHBOARD_DIR', dir);

    server = await startDashboardServer({
      port: 0,
      hello,
      sessions: new Map(),
      paneController: fakeController(),
    });
    const response = await fetch(`http://127.0.0.1:${server.port}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('test-dashboard');
  });
});
