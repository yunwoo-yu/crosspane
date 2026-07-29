import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerEvent, SessionEvent, SessionMeta } from '@crosspane/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import {
  captureFileStem,
  contentDisposition,
  type HubInfo,
  type HubServer,
  isAllowedWsOrigin,
  startHubServer,
} from '../src/server';

const meta = (id: string, label = 'test session'): SessionMeta => ({
  id,
  label,
  userAgent: 'jest-agent/1.0',
  url: 'http://localhost:3000',
  platform: 'browser',
  startedAt: Date.now(),
});

const consoleEvent = (sessionId: string, text: string): SessionEvent => ({
  type: 'console',
  sessionId,
  level: 'log',
  text,
  ts: Date.now(),
});

/** 수신 이벤트를 큐잉하는 대시보드 대역 — 핸드셰이크 직후 이벤트 유실 방지 */
class TestDashboard {
  private readonly queue: ServerEvent[] = [];
  private readonly waiters: ((event: ServerEvent) => void)[] = [];

  private constructor(readonly ws: WebSocket) {
    ws.on('message', (raw) => {
      const event = JSON.parse(String(raw)) as ServerEvent;
      const waiter = this.waiters.shift();
      if (waiter) waiter(event);
      else this.queue.push(event);
    });
  }

  static connect(port: number, origin?: string): Promise<TestDashboard> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
        headers: origin ? { origin } : {},
      });
      const dashboard = new TestDashboard(ws);
      ws.once('open', () => resolve(dashboard));
      ws.once('error', reject);
    });
  }

  next(): Promise<ServerEvent> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

/** 에이전트 대역 */
function connectAgent(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/agent`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

describe('startHubServer', () => {
  let server: HubServer | undefined;
  const sockets: WebSocket[] = [];

  afterEach(() => {
    for (const socket of sockets) socket.terminate();
    sockets.length = 0;
    server?.close();
    server = undefined;
    vi.unstubAllEnvs();
  });

  it('에이전트 등록 → 대시보드에 session-joined와 이벤트가 흐른다', async () => {
    server = await startHubServer({ port: 0 });
    const dashboard = await TestDashboard.connect(server.port);
    sockets.push(dashboard.ws);
    expect(await dashboard.next()).toEqual({ type: 'hello', sessions: [] });

    const agent = await connectAgent(server.port);
    sockets.push(agent);
    agent.send(JSON.stringify({ type: 'register', session: meta('s-1', '결제 웹뷰') }));
    const joined = await dashboard.next();
    expect(joined).toMatchObject({ type: 'session-joined', session: { id: 's-1' } });

    agent.send(JSON.stringify({ type: 'events', events: [consoleEvent('s-1', 'hello')] }));
    expect(await dashboard.next()).toMatchObject({
      type: 'console',
      sessionId: 's-1',
      text: 'hello',
    });
  });

  it('늦게 접속한 대시보드는 hello + 세션 히스토리를 받는다', async () => {
    server = await startHubServer({ port: 0 });
    const agent = await connectAgent(server.port);
    sockets.push(agent);
    agent.send(JSON.stringify({ type: 'register', session: meta('s-1') }));
    agent.send(
      JSON.stringify({
        type: 'events',
        events: [consoleEvent('s-1', 'a'), consoleEvent('s-1', 'b')],
      }),
    );
    // 서버가 이벤트를 반영할 시간
    await vi.waitFor(async () => {
      const late = await TestDashboard.connect(server?.port ?? 0);
      sockets.push(late.ws);
      const hello = await late.next();
      expect(hello).toMatchObject({ type: 'hello', sessions: [{ id: 's-1' }] });
      expect(await late.next()).toMatchObject({ type: 'console', text: 'a' });
      expect(await late.next()).toMatchObject({ type: 'console', text: 'b' });
    });
  });

  it('에이전트 연결이 끊기면 session-left가 브로드캐스트되고 히스토리는 남는다', async () => {
    server = await startHubServer({ port: 0 });
    const dashboard = await TestDashboard.connect(server.port);
    sockets.push(dashboard.ws);
    await dashboard.next(); // hello

    const agent = await connectAgent(server.port);
    agent.send(JSON.stringify({ type: 'register', session: meta('s-1') }));
    await dashboard.next(); // session-joined
    agent.send(JSON.stringify({ type: 'events', events: [consoleEvent('s-1', 'last words')] }));
    await dashboard.next(); // console
    agent.close();
    expect(await dashboard.next()).toMatchObject({ type: 'session-left', sessionId: 's-1' });

    // 늦게 접속해도 종료된 세션의 히스토리를 본다 (사후 분석)
    const late = await TestDashboard.connect(server.port);
    sockets.push(late.ws);
    await late.next(); // hello (세션 포함)
    expect(await late.next()).toMatchObject({ type: 'console', text: 'last words' });
    expect(await late.next()).toMatchObject({ type: 'session-left', sessionId: 's-1' });
  });

  it('다른 세션 id로 위조된 이벤트는 버린다', async () => {
    server = await startHubServer({ port: 0 });
    const dashboard = await TestDashboard.connect(server.port);
    sockets.push(dashboard.ws);
    await dashboard.next(); // hello

    const agent = await connectAgent(server.port);
    sockets.push(agent);
    agent.send(JSON.stringify({ type: 'register', session: meta('s-1') }));
    await dashboard.next(); // joined
    agent.send(
      JSON.stringify({
        type: 'events',
        events: [consoleEvent('s-999', 'forged'), consoleEvent('s-1', 'legit')],
      }),
    );
    expect(await dashboard.next()).toMatchObject({ sessionId: 's-1', text: 'legit' });
  });

  it('히스토리는 상한에서 앞이 잘린다', async () => {
    server = await startHubServer({ port: 0, historyLimit: 2 });
    const agent = await connectAgent(server.port);
    sockets.push(agent);
    agent.send(JSON.stringify({ type: 'register', session: meta('s-1') }));
    agent.send(
      JSON.stringify({
        type: 'events',
        events: [consoleEvent('s-1', '1'), consoleEvent('s-1', '2'), consoleEvent('s-1', '3')],
      }),
    );
    await vi.waitFor(async () => {
      const late = await TestDashboard.connect(server?.port ?? 0);
      sockets.push(late.ws);
      await late.next(); // hello
      expect(await late.next()).toMatchObject({ text: '2' });
      expect(await late.next()).toMatchObject({ text: '3' });
    });
  });

  it('종료된 세션은 retainedSessions 상한까지만 보관한다', async () => {
    server = await startHubServer({ port: 0, retainedSessions: 1 });
    // 두 세션을 차례로 등록·종료 → 오래된 쪽이 폐기돼야 한다
    for (const id of ['s-old', 's-new']) {
      const agent = await connectAgent(server.port);
      agent.send(JSON.stringify({ type: 'register', session: meta(id) }));
      agent.send(JSON.stringify({ type: 'events', events: [consoleEvent(id, `log-${id}`)] }));
      await new Promise((resolve) => setTimeout(resolve, 50));
      agent.close();
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await vi.waitFor(async () => {
      const late = await TestDashboard.connect(server?.port ?? 0);
      sockets.push(late.ws);
      const hello = (await late.next()) as { type: string; sessions: SessionMeta[] };
      expect(hello.sessions.map((s) => s.id)).toEqual(['s-new']);
    });
  });

  it('같은 세션 id로 재접속하면 히스토리를 이어간다 (웹뷰 백그라운드 복귀)', async () => {
    server = await startHubServer({ port: 0 });
    const first = await connectAgent(server.port);
    first.send(JSON.stringify({ type: 'register', session: meta('s-1') }));
    first.send(JSON.stringify({ type: 'events', events: [consoleEvent('s-1', 'before')] }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    first.close();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const second = await connectAgent(server.port);
    sockets.push(second);
    second.send(JSON.stringify({ type: 'register', session: meta('s-1') }));
    second.send(JSON.stringify({ type: 'events', events: [consoleEvent('s-1', 'after')] }));

    await vi.waitFor(async () => {
      const late = await TestDashboard.connect(server?.port ?? 0);
      sockets.push(late.ws);
      await late.next(); // hello
      expect(await late.next()).toMatchObject({ text: 'before' });
      expect(await late.next()).toMatchObject({ text: 'after' });
    });
  });

  it('등록 전에 보낸 이벤트는 무시한다', async () => {
    server = await startHubServer({ port: 0 });
    const dashboard = await TestDashboard.connect(server.port);
    sockets.push(dashboard.ws);
    await dashboard.next(); // hello

    const agent = await connectAgent(server.port);
    sockets.push(agent);
    agent.send(JSON.stringify({ type: 'events', events: [consoleEvent('s-x', 'orphan')] }));
    agent.send(JSON.stringify({ type: 'register', session: meta('s-1') }));
    // 첫 수신은 orphan이 아니라 session-joined여야 한다
    expect(await dashboard.next()).toMatchObject({ type: 'session-joined' });
  });

  it('잘못된 JSON은 서버를 죽이지 않는다', async () => {
    server = await startHubServer({ port: 0 });
    const agent = await connectAgent(server.port);
    sockets.push(agent);
    agent.send('not json at all');
    agent.send(JSON.stringify({ type: 'register', session: meta('s-1') }));
    await vi.waitFor(() => {
      expect(server?.sessions().map((s) => s.id)).toEqual(['s-1']);
    });
  });

  it('상한을 넘는 에이전트 메시지는 연결을 끊는다 (무인증 채널의 메모리 고갈 방지)', async () => {
    server = await startHubServer({ port: 0 });
    const agent = await connectAgent(server.port);
    sockets.push(agent);
    agent.send(JSON.stringify({ type: 'register', session: meta('s-1') }));
    await vi.waitFor(() => {
      expect(server?.sessions().map((s) => s.id)).toEqual(['s-1']);
    });

    const closed = new Promise<void>((resolve) => agent.once('close', () => resolve()));
    // /agent는 Origin 검증이 없는 채널이라(실기기 페이지의 Origin은 임의) 크기가
    // 유일한 방어선이다. 상한은 4MB — 넘기면 파싱하지 않고 즉시 끊어야 한다
    agent.send('x'.repeat(5 * 1024 * 1024));
    await closed;

    // 허브는 살아 있고 세션 히스토리도 오염되지 않는다
    const survivor = await connectAgent(server.port);
    sockets.push(survivor);
    survivor.send(JSON.stringify({ type: 'register', session: meta('s-2') }));
    await vi.waitFor(() => {
      expect(
        server
          ?.sessions()
          .map((s) => s.id)
          .sort(),
      ).toEqual(['s-1', 's-2']);
    });
  });

  it('GET /capture/:id — 라이브 세션을 캡처 파일로 내려준다', async () => {
    server = await startHubServer({ port: 0 });
    const agent = await connectAgent(server.port);
    sockets.push(agent);
    agent.send(JSON.stringify({ type: 'register', session: meta('s-1', '결제 웹뷰') }));
    agent.send(JSON.stringify({ type: 'events', events: [consoleEvent('s-1', 'saved')] }));

    await vi.waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${server?.port}/capture/s-1`);
      expect(response.status).toBe(200);
      // 다운로드로 처리돼야 브라우저가 파일로 저장한다
      expect(response.headers.get('content-disposition')).toContain('.crosspane.json');
      const capture = (await response.json()) as {
        version: number;
        session: { id: string };
        events: { type: string }[];
      };
      expect(capture.version).toBe(1);
      expect(capture.session.id).toBe('s-1');
      // 대시보드 표시용 엔트리가 아니라 원본 이벤트가 그대로 들어간다
      expect(capture.events.some((e) => e.type === 'console')).toBe(true);
    });
  });

  it('GET /capture/:id — 모르는 세션은 404', async () => {
    server = await startHubServer({ port: 0 });
    const response = await fetch(`http://127.0.0.1:${server.port}/capture/nope`);
    expect(response.status).toBe(404);
  });

  it('크로스사이트 Origin의 대시보드 WS 접속을 거부한다', async () => {
    server = await startHubServer({ port: 0 });
    const rejected = new Promise<Error>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${server?.port}/ws`, {
        headers: { origin: 'http://evil.example' },
      });
      ws.once('error', resolve);
      ws.once('open', () => resolve(new Error('connection should have been rejected')));
    });
    expect(String(await rejected)).toMatch(/401/);
  });

  it('포트가 사용 중이면 portAttempts 범위에서 +1 폴백한다', async () => {
    const blocker = await startHubServer({ port: 0 });
    try {
      server = await startHubServer({ port: blocker.port, portAttempts: 5 });
      expect(server.port).toBe(blocker.port + 1);
    } finally {
      blocker.close();
    }
  });

  it('CROSSPANE_DASHBOARD_DIR로 대시보드 정적 파일을 서빙한다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'crosspane-dash-'));
    writeFileSync(join(dir, 'index.html'), '<html>test-dashboard</html>');
    vi.stubEnv('CROSSPANE_DASHBOARD_DIR', dir);
    server = await startHubServer({ port: 0 });
    const response = await fetch(`http://127.0.0.1:${server.port}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('test-dashboard');
  });
});

describe('isAllowedWsOrigin', () => {
  it('Origin 없는 접속(비브라우저)과 루프백은 허용', () => {
    expect(isAllowedWsOrigin(undefined, 'localhost:7788')).toBe(true);
    expect(isAllowedWsOrigin('http://localhost:7788', 'x')).toBe(true);
    expect(isAllowedWsOrigin('http://127.0.0.1:9999', 'x')).toBe(true);
  });

  it('외부 Origin은 Host 헤더와 같은 오리진일 때만 허용', () => {
    expect(isAllowedWsOrigin('http://evil.example', 'localhost:7788')).toBe(false);
    expect(isAllowedWsOrigin('http://192.168.0.5:7788', '192.168.0.5:7788')).toBe(true);
    expect(isAllowedWsOrigin('not a url', 'localhost:7788')).toBe(false);
  });
});

describe('contentDisposition', () => {
  it('한국어 파일명을 ASCII 폴백 + UTF-8 형태로 함께 싣는다', () => {
    // Node의 헤더는 non-ASCII를 거부한다 — 그대로 넣으면 응답을 쓰며 던진다
    const header = contentDisposition('결제_웹뷰-s-1.crosspane.json');
    expect(header).toContain(
      `filename*=UTF-8''${encodeURIComponent('결제_웹뷰-s-1.crosspane.json')}`,
    );
    expect(/filename="[\x20-\x7E]+"/.test(header)).toBe(true);
  });

  it('따옴표·역슬래시를 무력화한다 (헤더 인젝션 방어)', () => {
    expect(contentDisposition('a"b\\c.json')).toContain('filename="a_b_c.json"');
  });
});

describe('captureFileStem', () => {
  it('한국어 라벨을 보존한다 — `\\w` 정제는 통째로 `_`로 만든다', () => {
    expect(captureFileStem('결제 웹뷰')).toBe('결제_웹뷰');
    expect(captureFileStem('결제 웹뷰 · QA build')).toBe('결제_웹뷰_QA_build');
  });

  it('경로 구분자와 상위 참조를 제거한다', () => {
    expect(captureFileStem('../../etc/passwd')).toBe('etc_passwd');
    expect(captureFileStem('a/b\\c')).toBe('a_b_c');
  });

  it('남는 문자가 없으면 기본 이름을 쓴다', () => {
    expect(captureFileStem('///')).toBe('session');
    expect(captureFileStem('')).toBe('session');
  });

  it('과도하게 긴 라벨을 자른다 (파일명 상한 방어)', () => {
    expect(captureFileStem('x'.repeat(200))).toHaveLength(60);
  });
});

describe('GET /hub-info', () => {
  let server: HubServer | undefined;
  afterEach(() => {
    server?.close();
    server = undefined;
  });

  it('로컬 전용이면 localhost 주소와 exposed=false를 알린다', async () => {
    server = await startHubServer({ port: 0 });
    const info = (await (
      await fetch(`http://127.0.0.1:${server.port}/hub-info`)
    ).json()) as HubInfo;

    expect(info.exposed).toBe(false);
    expect(info.port).toBe(server.port);
    // 대시보드가 이 값을 그대로 스니펫에 넣는다 — 실제 포트여야 한다
    expect(info.serverUrls).toEqual([`http://localhost:${server.port}`]);
  });

  it('--host로 노출하면 LAN 주소를 알린다 (실기기 serverUrl)', async () => {
    server = await startHubServer({ port: 0, host: '0.0.0.0' });
    const info = (await (
      await fetch(`http://127.0.0.1:${server.port}/hub-info`)
    ).json()) as HubInfo;

    expect(info.exposed).toBe(true);
    expect(info.serverUrls.length).toBeGreaterThan(0);
    for (const url of info.serverUrls) {
      expect(url).toMatch(new RegExp(`^http://.+:${server?.port}$`));
      expect(url).not.toContain('localhost');
    }
  });
});
