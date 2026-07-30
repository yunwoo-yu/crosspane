import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerEvent, SessionEvent, SessionMeta } from '@crosspane/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import {
  agentUrls,
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

  /** 받은 history-complete 개수 — 경계가 실제로 오는지 확인하는 테스트가 쓴다 */
  historyCompleteCount = 0;

  private constructor(readonly ws: WebSocket) {
    ws.on('message', (raw) => {
      const event = JSON.parse(String(raw)) as ServerEvent;
      // 경계 신호는 데이터가 아니므로 `next()` 흐름에서 빼 준다 — 넣으면 모든
      // 순차 단정이 프레임 하나씩 밀린다(실측). 신호 자체는 아래 카운터로 검증한다
      if (event.type === 'history-complete') {
        this.historyCompleteCount += 1;
        return;
      }
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
/** 조건이 참이 될 때까지 짧게 폴링 — 프레임 도착처럼 비동기인 것을 기다린다 */
async function waitFor(condition: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
}

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

  it('세션이 붙고 끊길 때 알린다 — 대시보드를 열지 않아도 알 수 있어야 한다', async () => {
    const events: string[] = [];
    server = await startHubServer({
      port: 0,
      onSessionChange: ({ kind, session }) =>
        events.push(`${kind}:${session.label}:${session.url}`),
    });
    const agent = await connectAgent(server.port);
    sockets.push(agent);
    agent.send(
      JSON.stringify({
        type: 'register',
        session: { ...meta('s-1', '결제 웹뷰'), url: 'https://shop.test/checkout' },
      }),
    );
    await waitFor(() => events.length === 1, 'joined');
    expect(events[0]).toBe('joined:결제 웹뷰:https://shop.test/checkout');

    agent.close();
    await waitFor(() => events.length === 2, 'left');
    expect(events[1]).toContain('left:결제 웹뷰');
  });

  it('재생이 끝나면 history-complete를 보낸다 — 접속당 한 번', async () => {
    server = await startHubServer({ port: 0 });
    const agent = await connectAgent(server.port);
    sockets.push(agent);
    agent.send(JSON.stringify({ type: 'register', session: meta('s-1') }));
    agent.send(JSON.stringify({ type: 'events', events: [consoleEvent('s-1', 'a')] }));
    await waitFor(() => server?.sessions().length === 1, 'session to register');

    const dashboard = await TestDashboard.connect(server.port);
    sockets.push(dashboard.ws);
    expect(await dashboard.next()).toMatchObject({ type: 'hello' });
    expect(await dashboard.next()).toMatchObject({ type: 'console', text: 'a' });
    // 경계가 히스토리 **뒤에** 온다 — 그래야 소비자가 전량을 받은 뒤 답할 수 있다
    await waitFor(() => dashboard.historyCompleteCount === 1, 'history-complete');

    // 이후 라이브 이벤트에는 붙지 않는다 (접속당 하나다)
    agent.send(JSON.stringify({ type: 'events', events: [consoleEvent('s-1', 'b')] }));
    expect(await dashboard.next()).toMatchObject({ type: 'console', text: 'b' });
    expect(dashboard.historyCompleteCount).toBe(1);
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

describe('agentUrls', () => {
  it('--lan-tls면 인증서가 덮는 이름으로 안내한다 — LAN IP는 이름이 안 맞아 조용히 실패한다', () => {
    expect(
      agentUrls({
        port: 7788,
        exposed: true,
        scheme: 'https',
        tlsHostname: '10-0-0-2.local-ip.sh',
      }),
    ).toEqual(['https://10-0-0-2.local-ip.sh:7788']);
  });

  it('노출되지 않았으면 localhost만 안내한다', () => {
    expect(agentUrls({ port: 7788, exposed: false, scheme: 'http' })).toEqual([
      'http://localhost:7788',
    ]);
  });

  it('TLS면 https로 안내한다 — 에이전트가 이걸 wss로 바꾼다', () => {
    expect(agentUrls({ port: 7788, exposed: false, scheme: 'https' })).toEqual([
      'https://localhost:7788',
    ]);
  });

  it('키가 없으면 주소만 준다 — 앱 env에 붙일 것이 주소 하나여야 한다', () => {
    expect(agentUrls({ port: 7788, exposed: false, scheme: 'http' })).toEqual([
      'http://localhost:7788',
    ]);
  });

  it('키를 설정했을 때만 담고, 읽기 토큰은 절대 담지 않는다', () => {
    // 이 주소는 배포된 페이지의 클라이언트로 들어가 페이지 소스에 노출된다(실측).
    // 읽기 토큰이 여기 있으면 누구나 세션 로그를 읽는다
    const urls = agentUrls({ port: 7788, exposed: false, scheme: 'http', ingestKey: 'k1' });
    expect(urls).toEqual(['http://localhost:7788/?k=k1']);
    expect(urls[0]).not.toContain('t=');
  });

  it('publicUrl이 있으면 그것만 안내한다 — 닿지 않는 LAN 주소를 함께 보이면 그걸 골라 실패한다', () => {
    expect(
      agentUrls({
        port: 7788,
        exposed: true,
        scheme: 'http',
        ingestKey: 'k1',
        publicUrl: 'https://xyz.trycloudflare.com',
      }),
    ).toEqual(['https://xyz.trycloudflare.com/?k=k1']);
  });

  it('publicUrl의 끝 슬래시를 정리한다 — //?k= 가 되면 경로가 어긋난다', () => {
    expect(
      agentUrls({
        port: 7788,
        exposed: true,
        scheme: 'http',
        ingestKey: 'k1',
        publicUrl: 'https://xyz.example/',
      }),
    ).toEqual(['https://xyz.example/?k=k1']);
  });

  it('publicUrl에 경로가 있어도 유지한다 (스테이징 오리진 리버스 프록시)', () => {
    expect(
      agentUrls({
        port: 7788,
        exposed: true,
        scheme: 'http',
        publicUrl: 'https://staging.example.com/__crosspane',
      }),
    ).toEqual(['https://staging.example.com/__crosspane']);
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

describe('접속 토큰 (authToken)', () => {
  let server: HubServer | undefined;
  const sockets: WebSocket[] = [];
  const TOKEN = 'deadbeefcafe1234';

  afterEach(() => {
    for (const socket of sockets) socket.terminate();
    sockets.length = 0;
    server?.close();
    server = undefined;
  });

  const ws = (path: string): Promise<'open' | 'rejected'> =>
    new Promise((resolve) => {
      const socket = new WebSocket(`ws://127.0.0.1:${server?.port}${path}`);
      sockets.push(socket);
      socket.once('open', () => resolve('open'));
      socket.once('error', () => resolve('rejected'));
    });

  it('토큰이 없으면 예전처럼 모두 통과한다 (로컬 전용 기본값)', async () => {
    server = await startHubServer({ port: 0 });
    expect(await ws('/ws')).toBe('open');
    expect(await ws('/agent')).toBe('open');
    expect((await fetch(`http://127.0.0.1:${server.port}/hub-info`)).status).toBe(200);
  });

  describe('토큰이 설정되면', () => {
    it('토큰 없는 WS 접속을 거부한다 — 세션 로그를 읽는 경로다', async () => {
      server = await startHubServer({ port: 0, authToken: TOKEN });
      expect(await ws('/ws')).toBe('rejected');
      expect(await ws(`/ws?t=${TOKEN}`)).toBe('open');
    });

    it('읽기 토큰만 설정되면 /agent는 열려 있다 — 앱이 들고 다닐 값이 없어야 한다', async () => {
      // 공개 페이지에 비밀을 담을 수 없으므로, 앱이 제시할 값은 결국 누구나 볼 수 있다.
      // 그래서 쓰기는 열고 **읽기만** 막는다 (`isIngestAuthorized` 주석 참조).
      // 위험은 주입뿐이고 읽기가 아니다 — 아래 /ws·/capture 테스트가 그쪽을 지킨다
      server = await startHubServer({ port: 0, authToken: TOKEN });
      expect(await ws('/agent')).toBe('open');
      expect(await ws(`/agent?t=${TOKEN}`)).toBe('open'); // 기존 serverUrl 하위호환
    });

    it('--ingest-key를 주면 /agent도 닫힌다 — 상시 팀 허브용', async () => {
      server = await startHubServer({ port: 0, authToken: TOKEN, ingestKey: 'k1' });
      expect(await ws('/agent')).toBe('rejected');
      expect(await ws('/agent?k=wrong')).toBe('rejected');
      expect(await ws('/agent?k=k1')).toBe('open');
      expect(await ws(`/agent?t=${TOKEN}`)).toBe('open'); // 하위호환
    });

    it('/capture/:id와 /hub-info를 401로 막는다', async () => {
      server = await startHubServer({ port: 0, authToken: TOKEN });
      const base = `http://127.0.0.1:${server.port}`;
      expect((await fetch(`${base}/hub-info`)).status).toBe(401);
      expect((await fetch(`${base}/capture/s-1`)).status).toBe(401);
      expect((await fetch(`${base}/hub-info?t=${TOKEN}`)).status).toBe(200);
    });

    it('대시보드 셸(정적 파일)은 막지 않는다 — 토큰을 넣을 화면을 열 수 있어야 한다', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'crosspane-auth-'));
      writeFileSync(join(dir, 'index.html'), '<html>shell</html>');
      vi.stubEnv('CROSSPANE_DASHBOARD_DIR', dir);
      server = await startHubServer({ port: 0, authToken: TOKEN });

      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      expect(response.status).toBe(200);
      vi.unstubAllEnvs();
    });

    it('serverUrls에는 인제스트 키만 담는다 — 읽기 토큰이 새면 안 된다', async () => {
      server = await startHubServer({ port: 0, authToken: TOKEN, ingestKey: 'ingest1' });
      const info = (await (
        await fetch(`http://127.0.0.1:${server.port}/hub-info?t=${TOKEN}`)
      ).json()) as HubInfo;
      for (const url of info.serverUrls) {
        expect(url).toContain('k=ingest1');
        // 이 주소는 배포된 페이지에 그대로 실린다 — 읽기 토큰이 들어가면 전부 읽힌다(실측)
        expect(url).not.toContain(TOKEN);
      }
    });
  });

  describe('읽기와 쓰기 자격 분리', () => {
    const READ = 'read-token';
    const INGEST = 'ingest-key';

    it('인제스트 키로는 /agent에 붙지만 /ws로는 붙지 못한다 (핵심 회귀)', async () => {
      server = await startHubServer({ port: 0, authToken: READ, ingestKey: INGEST });
      const base = `ws://127.0.0.1:${server.port}`;
      await expect(connects(`${base}/agent?k=${INGEST}`)).resolves.toBe(true);
      // 여기가 무너지면 공개된 키로 남의 세션 로그를 전량 읽을 수 있다
      await expect(connects(`${base}/ws?k=${INGEST}`)).resolves.toBe(false);
    });

    it('인제스트 키로는 캡처·허브정보도 읽지 못한다', async () => {
      server = await startHubServer({ port: 0, authToken: READ, ingestKey: INGEST });
      const info = await fetch(`http://127.0.0.1:${server.port}/hub-info?k=${INGEST}`);
      expect(info.status).toBe(401);
    });

    it('읽기 토큰은 /agent에도 통한다 — 기존 serverUrl(?t=)을 끊지 않는다', async () => {
      server = await startHubServer({ port: 0, authToken: READ, ingestKey: INGEST });
      await expect(connects(`ws://127.0.0.1:${server.port}/agent?t=${READ}`)).resolves.toBe(true);
    });

    it('둘 다 아니면 /agent도 거절한다', async () => {
      server = await startHubServer({ port: 0, authToken: READ, ingestKey: INGEST });
      await expect(connects(`ws://127.0.0.1:${server.port}/agent?k=wrong`)).resolves.toBe(false);
      await expect(connects(`ws://127.0.0.1:${server.port}/agent`)).resolves.toBe(false);
    });
  });
});

/** WS 접속이 성립하는지 — 401이면 false */
function connects(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new WebSocket(url, { origin: 'http://localhost' });
    socket.on('open', () => {
      socket.close();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    setTimeout(() => resolve(false), 3_000);
  });
}

describe('허브 히스토리 상한도 버린 수를 밝힌다', () => {
  let server: HubServer | undefined;
  const sockets: WebSocket[] = [];
  afterEach(() => {
    for (const socket of sockets) socket.terminate();
    sockets.length = 0;
    server?.close();
    server = undefined;
  });

  it('GET /capture/:id의 droppedEvents에 실린다', async () => {
    server = await startHubServer({ port: 0, historyLimit: 2 });
    const agent = await connectAgent(server.port);
    sockets.push(agent);
    agent.send(JSON.stringify({ type: 'register', session: meta('s-1') }));
    agent.send(
      JSON.stringify({
        type: 'events',
        events: Array.from({ length: 9 }, (_, i) => consoleEvent('s-1', `line${i}`)),
      }),
    );

    await vi.waitFor(async () => {
      const capture = (await (
        await fetch(`http://127.0.0.1:${server?.port}/capture/s-1`)
      ).json()) as { events: unknown[]; droppedEvents: number };
      expect(capture.events).toHaveLength(2);
      expect(capture.droppedEvents).toBe(7);
    });
  });
});
