import type { Readable, Writable } from 'node:stream';
import type { ServerEvent } from '@crosspane/protocol';
import { WebSocket } from 'ws';
import { debugLog } from '../debug.js';
import { errorResponse, handleRpcMessage, JSON_RPC_PARSE_ERROR } from './rpc.js';
import { SessionStore } from './store.js';
import type { ToolContext } from './tools.js';

/**
 * `crosspane mcp` — 코딩 에이전트가 실기기 세션을 직접 질의하는 MCP stdio 서버.
 *
 * 허브에 **대시보드 클라이언트로** 붙는다(`/ws`). 허브가 접속 시 hello + 히스토리를
 * 전량 재생하므로 조회 API도, 공유 상태도 필요 없다 — 허브 코드 수정 0.
 *
 * stdout은 JSON-RPC 전용이다. 진단 출력은 전부 stderr로 보낼 것 —
 * stdout에 한 줄이라도 섞이면 클라이언트가 파싱 실패로 연결을 끊는다.
 */

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 10_000;
/** 첫 연결 시도를 기다리는 상한 — 넘으면 미연결로 보고한다 (툴을 무한정 붙잡지 않는다) */
const FIRST_CONNECT_GRACE_MS = 3_000;

export interface McpServerOptions {
  /** 허브 주소 (예: http://127.0.0.1:7788) */
  hubUrl: string;
  /** 테스트 주입용 — 기본은 프로세스 stdio */
  input?: Readable;
  output?: Writable;
  /**
   * 입력이 닫히고 처리 중이던 요청이 모두 응답된 뒤 호출된다.
   * 클라이언트가 stdin을 닫는 것이 MCP stdio의 정상 종료 신호다.
   */
  onInputEnd?: () => void;
}

export interface McpServer {
  close(): void;
}

export function startMcpServer(options: McpServerOptions): McpServer {
  const store = new SessionStore();
  let connected = false;
  let socket: WebSocket | null = null;
  let retryTimer: NodeJS.Timeout | null = null;
  let attempt = 0;
  let closed = false;

  // 첫 연결 시도가 성공이든 실패든 끝났는지. 이후 재접속에서는 다시 막지 않는다 —
  // 한 번 붙었다가 끊긴 것은 즉시 보고해야 하는 사실이다
  let settled = false;
  const waiters: (() => void)[] = [];
  const settle = (): void => {
    settled = true;
    for (const resume of waiters.splice(0)) resume();
  };

  const connect = (): void => {
    if (closed) return;
    const url = toWebSocketUrl(options.hubUrl);
    const next = new WebSocket(url);
    socket = next;
    next.on('open', () => {
      connected = true;
      attempt = 0;
      settle();
      debugLog('mcp', `connected to hub ${url}`);
    });
    next.on('message', (raw) => {
      try {
        store.apply(JSON.parse(String(raw)) as ServerEvent);
      } catch (err) {
        debugLog('mcp', err); // 허브가 보낸 잘못된 페이로드로 죽지 않는다
      }
    });
    // 허브가 아직 안 떴을 수도 있다 — 조용히 재시도하고, 툴이 연결 상태를 보고한다
    next.on('error', (err) => debugLog('mcp', err));
    next.on('close', () => {
      connected = false;
      settle(); // 첫 시도가 실패했다면 여기서 끝난다 — 백오프를 기다리게 하지 않는다
      if (closed || socket !== next) return;
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
      attempt += 1;
      retryTimer = setTimeout(connect, delay);
    });
  };

  const ctx: ToolContext = {
    store,
    hubConnected: () => connected,
    waitForHub: () =>
      settled
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, FIRST_CONNECT_GRACE_MS);
            waiters.push(() => {
              clearTimeout(timer);
              resolve();
            });
          }),
    hubUrl: options.hubUrl,
  };

  connect();
  serveStdio(
    options.input ?? process.stdin,
    options.output ?? process.stdout,
    ctx,
    options.onInputEnd,
  );

  return {
    close() {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
    },
  };
}

/**
 * MCP stdio 프레이밍: 줄바꿈으로 구분된 JSON. 요청 하나에 응답 한 줄.
 * (전송을 주입할 수 있게 분리 — 스트림 두 개로 테스트된다)
 *
 * `onInputEnd`는 stdin이 닫히고 **처리 중이던 요청이 모두 응답된 뒤** 호출된다.
 * 닫히는 즉시 종료하면 아직 쓰이지 않은 응답이 잘려 나간다 (실측).
 */
export function serveStdio(
  input: Readable,
  output: Writable,
  ctx: ToolContext,
  onInputEnd?: () => void,
): void {
  let buffer = '';
  const inFlight = new Set<Promise<void>>();

  input.setEncoding('utf8');
  input.on('data', (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      // 응답은 id로 짝지어지므로 순서를 지킬 필요가 없다 — 직렬화하면 느린 요청 하나가
      // 뒤따르는 전부를 막는다 (허브 대기 중인 tools/call이 ping을 붙잡는 식으로)
      if (line !== '') {
        const task = handleLine(line, output, ctx);
        inFlight.add(task);
        void task.finally(() => inFlight.delete(task));
      }
      newline = buffer.indexOf('\n');
    }
  });

  input.on('end', () => {
    void (async () => {
      // 요청 처리가 새 요청을 만들지 않으므로 비워질 때까지 도는 것으로 충분하다
      while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
      onInputEnd?.();
    })();
  });
}

async function handleLine(line: string, output: Writable, ctx: ToolContext): Promise<void> {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    write(output, errorResponse(null, JSON_RPC_PARSE_ERROR, 'Parse error'));
    return;
  }
  const response = await handleRpcMessage(message, ctx);
  if (response) write(output, response);
}

function write(output: Writable, response: unknown): void {
  output.write(`${JSON.stringify(response)}\n`);
}

/** http(s):// 허브 주소 → 대시보드 WS 엔드포인트 */
export function toWebSocketUrl(hubUrl: string): string {
  const url = new URL(hubUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/ws';
  url.search = '';
  return url.toString();
}
