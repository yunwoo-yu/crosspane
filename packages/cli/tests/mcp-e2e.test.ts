import { PassThrough } from 'node:stream';
import type { SessionEvent, SessionMeta } from '@crosspane/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { type McpServer, startMcpServer } from '../src/mcp/index.js';
import { type HubServer, startHubServer } from '../src/server.js';

/**
 * 실제 허브 + 실제 MCP 서버 왕복. 이 설계의 전제("MCP를 대시보드 클라이언트로 붙이면
 * 히스토리를 공짜로 받는다")가 유닛 테스트로는 검증되지 않으므로 여기서 확인한다.
 */

const meta = (id: string, label: string): SessionMeta => ({
  id,
  label,
  userAgent: 'e2e/1.0',
  url: 'https://shop.test/pay',
  platform: 'android-webview',
  startedAt: Date.now(),
});

function connectAgent(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/agent`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

/** MCP 클라이언트 대역 — 요청을 쓰고 id로 응답을 기다린다 */
class TestClient {
  private readonly stdin = new PassThrough();
  private readonly stdout = new PassThrough();
  private readonly pending = new Map<number, (result: unknown) => void>();
  private buffer = '';
  private nextId = 1;

  constructor(hubUrl: string) {
    this.stdout.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString();
      let newline = this.buffer.indexOf('\n');
      while (newline !== -1) {
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        const message = JSON.parse(line) as { id: number; result?: unknown };
        this.pending.get(message.id)?.(message.result);
        this.pending.delete(message.id);
        newline = this.buffer.indexOf('\n');
      }
    });
    this.server = startMcpServer({ hubUrl, input: this.stdin, output: this.stdout });
  }

  readonly server: McpServer;

  request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<string> {
    const result = (await this.request('tools/call', { name, arguments: args })) as {
      content: { text: string }[];
    };
    return result.content[0].text;
  }
}

/** 조건이 참이 될 때까지 기다린다 — WS 전파는 비동기다 */
async function until(predicate: () => boolean | Promise<boolean>, label: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${label}`);
}

describe('crosspane mcp ↔ hub', () => {
  let hub: HubServer | undefined;
  const sockets: WebSocket[] = [];
  const clients: TestClient[] = [];

  /** 테스트 본문에서 const로 잡을 수 있게 — 클로저에서 non-null 단정을 쓰지 않는다 */
  function newClient(hubUrl: string): TestClient {
    const client = new TestClient(hubUrl);
    clients.push(client);
    return client;
  }

  afterEach(() => {
    for (const socket of sockets) socket.terminate();
    sockets.length = 0;
    for (const client of clients) client.server.close();
    clients.length = 0;
    hub?.close();
    hub = undefined;
  });

  it('허브에 이미 있던 세션의 히스토리를 접속만으로 받아온다', async () => {
    hub = await startHubServer({ port: 0 });

    // MCP 서버가 붙기 **전에** 세션이 생기고 이벤트가 흐른다
    const agent = await connectAgent(hub.port);
    sockets.push(agent);
    agent.send(JSON.stringify({ type: 'register', session: meta('s-1', '결제 웹뷰') }));
    const events: SessionEvent[] = [
      { type: 'console', sessionId: 's-1', level: 'error', text: 'card token missing', ts: 1 },
      {
        type: 'network',
        sessionId: 's-1',
        method: 'POST',
        url: 'https://api.test/pay',
        status: 502,
        durationMs: 900,
        ts: 2,
      },
    ];
    agent.send(JSON.stringify({ type: 'events', events }));
    await until(() => hub?.sessions().length === 1, 'hub to register the session');

    const client = newClient(`http://127.0.0.1:${hub.port}`);
    await client.request('initialize');

    // 폴링 없이 곧바로 묻는다 — 클라이언트는 기동 직후 부르므로, 첫 호출이
    // WS 핸드셰이크를 앞질러 "미연결"이라 답하면 안 된다 (실측된 레이스)
    const listed = await client.callTool('list_sessions');
    expect(listed).toContain('s-1');
    expect(listed).toContain('결제 웹뷰');
    expect(listed).toContain('connected');

    // 라벨로도 지목할 수 있다 — 에이전트가 id를 몰라도 질의된다
    const errors = await client.callTool('get_errors', { session: '결제' });
    expect(errors).toContain('card token missing');
    expect(errors).toContain('502');
  });

  it('접속 후 도착한 라이브 이벤트도 보인다', async () => {
    hub = await startHubServer({ port: 0 });
    const client = newClient(`http://127.0.0.1:${hub.port}`);
    await client.request('initialize');
    expect(await client.callTool('list_sessions')).toContain('— connected');

    const agent = await connectAgent(hub.port);
    sockets.push(agent);
    agent.send(JSON.stringify({ type: 'register', session: meta('s-2', 'home') }));
    agent.send(
      JSON.stringify({
        type: 'events',
        events: [{ type: 'pageerror', sessionId: 's-2', message: 'boom', ts: 3 }],
      }),
    );

    await until(async () => (await client.callTool('get_errors')).includes('boom'), 'live event');
  });

  it('허브가 없으면 툴이 조용히 실패하며 기동 방법을 안내한다', async () => {
    // 아무도 듣지 않는 포트 — 재접속 백오프가 돌지만 프로세스는 살아 있어야 한다
    const client = newClient('http://127.0.0.1:1');
    await client.request('initialize');
    const text = await client.callTool('list_sessions');
    expect(text).toContain('NOT connected');
  });
});
