import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import type { ClientMessage, EngineName, HelloMessage, ServerMessage } from './protocol.js';
import type { EngineSession } from './session.js';
import { defaultDashboardDir, serveStatic } from './static.js';

export interface AppServer {
  /** 실제로 바인딩된 포트. opts.port에 0을 주면 OS가 할당한 임의 포트가 들어온다 */
  port: number;
  broadcast(msg: ServerMessage): void;
  close(): void;
}

export interface ServerOptions {
  port: number;
  hello: () => HelloMessage;
  sessions: ReadonlyMap<EngineName, EngineSession>;
}

/** 대시보드에서 받은 입력 메시지 하나를 특정 엔진 세션에 재생한다 */
function applyInput(session: EngineSession, msg: ClientMessage): Promise<void> {
  switch (msg.type) {
    case 'click':
      return session.click(msg.x, msg.y);
    case 'scroll':
      return session.scroll(msg.deltaY);
    case 'keypress':
      return session.keypress(msg.key);
    case 'reload':
      return session.reload();
    case 'navigate':
      return session.navigate(msg.url);
  }
}

/**
 * 입력 미러링: 하나의 입력을 모든 엔진에 동시에 재생한다.
 * 특정 엔진이 실패(내비게이션 중 등)해도 나머지는 계속돼야 하므로 allSettled를 쓴다.
 */
async function dispatch(
  sessions: ReadonlyMap<EngineName, EngineSession>,
  msg: ClientMessage,
): Promise<void> {
  await Promise.allSettled(
    [...sessions.values()].map((session) => {
      session.boost();
      return applyInput(session, msg);
    }),
  );
}

// 대시보드가 나중에 접속해도 이전 로그를 볼 수 있도록 유지하는 이벤트 개수
const HISTORY_LIMIT = 300;

export function startServer(opts: ServerOptions): Promise<AppServer> {
  const dashboardDir = defaultDashboardDir();

  const server = http.createServer((req, res) => {
    void serveStatic(dashboardDir, req, res);
  });

  const wss = new WebSocketServer({ server, path: '/ws' });
  // http 서버의 EADDRINUSE 등이 wss로도 전파되는데, 핸들러가 없으면
  // unhandled 'error'로 프로세스가 크래시한다. 처리는 server.once('error')가 담당.
  wss.on('error', () => {});

  // 접속 전에 발생한 콘솔/에러/네트워크 이벤트와 마지막 엔진 상태를
  // 새 클라이언트에게 재전송하기 위한 버퍼
  const history: ServerMessage[] = [];
  const lastStatus = new Map<EngineName, ServerMessage>();
  const record = (msg: ServerMessage): void => {
    if (msg.type === 'console' || msg.type === 'pageerror' || msg.type === 'requestfailed') {
      history.push(msg);
      if (history.length > HISTORY_LIMIT) history.shift();
    } else if (msg.type === 'engine-status') {
      lastStatus.set(msg.engine, msg);
    }
  };

  wss.on('connection', (ws) => {
    // 새 클라이언트에게 현재 세션 구성(타깃 URL, 기기, 엔진 목록)을 먼저 알려준다
    ws.send(JSON.stringify(opts.hello()));
    for (const status of lastStatus.values()) ws.send(JSON.stringify(status));
    for (const msg of history) ws.send(JSON.stringify(msg));
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as ClientMessage;
        void dispatch(opts.sessions, msg);
      } catch {
        // 잘못된 형식의 클라이언트 메시지는 무시 (서버가 죽으면 안 됨)
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', (err) => {
      const isAddrInUse = (err as NodeJS.ErrnoException).code === 'EADDRINUSE';
      reject(
        isAddrInUse
          ? new Error(`Port ${opts.port} is already in use — try a different --port`)
          : err,
      );
    });
    server.listen(opts.port, () => {
      resolve({
        port: (server.address() as AddressInfo).port,
        broadcast(msg: ServerMessage) {
          record(msg);
          const payload = JSON.stringify(msg);
          for (const client of wss.clients) {
            if (client.readyState === WebSocket.OPEN) client.send(payload);
          }
        },
        close() {
          // server.close()는 열린 소켓이 남아 있으면 대기하므로 클라이언트를 먼저 끊는다
          for (const client of wss.clients) client.terminate();
          wss.close();
          server.close();
        },
      });
    });
  });
}
