import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { EngineName, HelloMessage, ServerMessage } from '../src/protocol';
import { type AppServer, startServer } from '../src/server';
import type { EngineSession } from '../src/session';

/** 실제 브라우저 없이 입력 미러링을 검증하기 위한 EngineSession 대역 */
function fakeSession() {
  return {
    click: vi.fn(async () => {}),
    scroll: vi.fn(async () => {}),
    keypress: vi.fn(async () => {}),
    reload: vi.fn(async () => {}),
    navigate: vi.fn(async () => {}),
    boost: vi.fn(),
  };
}

const hello = (): HelloMessage => ({
  type: 'hello',
  url: 'http://localhost:3000',
  device: 'iPhone 15',
  engines: ['chromium'] as EngineName[],
  viewport: { width: 390, height: 844 },
});

/**
 * 서버가 보내는 메시지(hello 등)는 핸드셰이크 직후 open과 같은 틱에 도착할 수 있어
 * open 이후에 리스너를 붙이면 놓친다. 연결 시점에 리스너를 붙이고 큐에 쌓아둔다.
 */
class TestClient {
  private readonly queue: ServerMessage[] = [];
  private readonly waiters: ((msg: ServerMessage) => void)[] = [];

  private constructor(readonly ws: WebSocket) {
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as ServerMessage;
      const waiter = this.waiters.shift();
      if (waiter) waiter(msg);
      else this.queue.push(msg);
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

  next(): Promise<ServerMessage> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  send(msg: unknown): void {
    this.ws.send(JSON.stringify(msg));
  }
}

describe('startServer', () => {
  let server: AppServer | undefined;
  const clients: TestClient[] = [];

  afterEach(() => {
    for (const client of clients) client.ws.terminate();
    clients.length = 0;
    server?.close();
    server = undefined;
    vi.unstubAllEnvs();
  });

  it('접속하면 hello를 먼저 보낸다', async () => {
    server = await startServer({ port: 0, hello, sessions: new Map() });
    const client = await TestClient.connect(server.port);
    clients.push(client);
    const msg = await client.next();
    expect(msg).toMatchObject({ type: 'hello', device: 'iPhone 15' });
  });

  it('입력이 모든 세션에 미러링된다', async () => {
    const a = fakeSession();
    const b = fakeSession();
    const sessions = new Map([
      ['chromium', a as unknown as EngineSession],
      ['webkit', b as unknown as EngineSession],
    ] as [EngineName, EngineSession][]);
    server = await startServer({ port: 0, hello, sessions });
    const client = await TestClient.connect(server.port);
    clients.push(client);

    client.send({ type: 'click', x: 0.5, y: 0.25 });
    await vi.waitFor(() => {
      expect(a.click).toHaveBeenCalledWith(0.5, 0.25);
      expect(b.click).toHaveBeenCalledWith(0.5, 0.25);
    });

    client.send({ type: 'scroll', deltaY: 120 });
    await vi.waitFor(() => {
      expect(a.scroll).toHaveBeenCalledWith(120);
      expect(b.scroll).toHaveBeenCalledWith(120);
    });
  });

  it('잘못된 JSON을 받아도 죽지 않고 다음 메시지를 처리한다', async () => {
    const a = fakeSession();
    const sessions = new Map([['chromium', a as unknown as EngineSession]] as [
      EngineName,
      EngineSession,
    ][]);
    server = await startServer({ port: 0, hello, sessions });
    const client = await TestClient.connect(server.port);
    clients.push(client);

    client.ws.send('not-json{{{');
    client.send({ type: 'reload' });
    await vi.waitFor(() => {
      expect(a.reload).toHaveBeenCalled();
    });
  });

  it('broadcast가 연결된 모든 클라이언트에 전달된다', async () => {
    server = await startServer({ port: 0, hello, sessions: new Map() });
    const c1 = await TestClient.connect(server.port);
    const c2 = await TestClient.connect(server.port);
    clients.push(c1, c2);
    await Promise.all([c1.next(), c2.next()]); // hello 소비

    const received = Promise.all([c1.next(), c2.next()]);
    server.broadcast({ type: 'frame', engine: 'chromium', data: 'abc' });
    const [m1, m2] = await received;
    expect(m1).toEqual({ type: 'frame', engine: 'chromium', data: 'abc' });
    expect(m2).toEqual({ type: 'frame', engine: 'chromium', data: 'abc' });
  });

  it('접속 전에 발생한 로그를 새 클라이언트에 재전송한다', async () => {
    server = await startServer({ port: 0, hello, sessions: new Map() });
    // 클라이언트가 없을 때 발생한 이벤트
    server.broadcast({
      type: 'console',
      engine: 'chromium',
      level: 'log',
      text: 'early-log',
      ts: 1,
    });
    server.broadcast({ type: 'engine-status', engine: 'chromium', status: 'ready' });

    const client = await TestClient.connect(server.port);
    clients.push(client);
    expect(await client.next()).toMatchObject({ type: 'hello' });
    expect(await client.next()).toMatchObject({ type: 'engine-status', status: 'ready' });
    expect(await client.next()).toMatchObject({ type: 'console', text: 'early-log' });
  });

  it('사용 중인 포트면 명확한 에러로 실패한다', async () => {
    server = await startServer({ port: 0, hello, sessions: new Map() });
    await expect(startServer({ port: server.port, hello, sessions: new Map() })).rejects.toThrow(
      /already in use/,
    );
  });

  it('CROSSPANE_DASHBOARD_DIR로 대시보드 정적 파일을 서빙한다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'crosspane-dash-'));
    writeFileSync(join(dir, 'index.html'), '<html>test-dashboard</html>');
    vi.stubEnv('CROSSPANE_DASHBOARD_DIR', dir);

    server = await startServer({ port: 0, hello, sessions: new Map() });
    const res = await fetch(`http://127.0.0.1:${server.port}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('test-dashboard');
  });
});
