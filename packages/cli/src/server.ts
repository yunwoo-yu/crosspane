import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import {
  type ClientCommand,
  type EngineName,
  encodeFramePacket,
  type HelloEvent,
  type ServerEvent,
} from './protocol.js';
import type { InputTarget } from './session.js';
import { resolveDashboardDir, serveDashboardFile } from './static.js';

export interface DashboardServer {
  /** 실제로 바인딩된 포트. options.port에 0을 주면 OS가 할당한 임의 포트가 들어온다 */
  port: number;
  broadcastEvent(event: ServerEvent): void;
  broadcastFrame(engine: EngineName, jpeg: Buffer, scrollY: number): void;
  close(): void;
}

export interface DashboardServerOptions {
  port: number;
  hello: () => HelloEvent;
  sessions: ReadonlyMap<EngineName, InputTarget>;
}

// 대시보드가 나중에 접속해도 이전 로그를 볼 수 있도록 유지하는 이벤트 개수
const EVENT_HISTORY_LIMIT = 300;

/** 입력 커맨드 하나를 특정 엔진 세션에 재생한다 */
function applyCommandToSession(session: InputTarget, command: ClientCommand): Promise<void> {
  switch (command.type) {
    case 'click':
      return session.clickAt(command.x, command.y);
    case 'scroll':
      return session.scrollBy(command.deltaY);
    case 'keypress':
      return session.pressKey(command.key);
    case 'type':
      return session.typeText(command.text);
    case 'back':
      return session.goBack();
    case 'forward':
      return session.goForward();
    case 'reload':
      return session.reload();
    case 'navigate':
      return session.navigate(command.url);
  }
}

/**
 * 입력 미러링: 하나의 커맨드를 모든 엔진에 동시에 재생한다.
 * 특정 엔진이 실패(내비게이션 중 등)해도 나머지는 계속돼야 하므로 allSettled를 쓴다.
 */
async function mirrorCommandToSessions(
  sessions: ReadonlyMap<EngineName, InputTarget>,
  command: ClientCommand,
): Promise<void> {
  await Promise.allSettled(
    [...sessions.values()].map((session) => {
      session.markActivity();
      return applyCommandToSession(session, command);
    }),
  );
}

export function startDashboardServer(options: DashboardServerOptions): Promise<DashboardServer> {
  const dashboardDir = resolveDashboardDir();

  const httpServer = http.createServer((req, res) => {
    void serveDashboardFile(dashboardDir, req, res);
  });

  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  // http 서버의 EADDRINUSE 등이 wss로도 전파되는데, 핸들러가 없으면
  // unhandled 'error'로 프로세스가 크래시한다. 처리는 httpServer.once('error')가 담당.
  wss.on('error', () => {});

  // 접속 전에 발생한 콘솔/에러/네트워크 이벤트와 마지막 엔진 상태를
  // 새 클라이언트에게 재전송하기 위한 버퍼
  const eventHistory: ServerEvent[] = [];
  const lastStatusByEngine = new Map<EngineName, ServerEvent>();
  const lastNavigationByEngine = new Map<EngineName, ServerEvent>();
  // 변화가 없으면 프레임이 다시 오지 않으므로(스크린캐스트/변화감지 스킵),
  // 늦게 접속한 클라이언트를 위해 엔진별 마지막 프레임을 캐시한다
  const lastFramePacketByEngine = new Map<EngineName, Buffer>();
  const recordForReplay = (event: ServerEvent): void => {
    switch (event.type) {
      case 'console':
      case 'pageerror':
      case 'requestfailed':
      case 'httperror':
        eventHistory.push(event);
        if (eventHistory.length > EVENT_HISTORY_LIMIT) eventHistory.shift();
        break;
      case 'engine-status':
        lastStatusByEngine.set(event.engine, event);
        break;
      case 'navigation':
        lastNavigationByEngine.set(event.engine, event);
        break;
      case 'hello':
        break;
    }
  };

  wss.on('connection', (client) => {
    // 새 클라이언트에게 현재 세션 구성(타깃 URL, 기기, 엔진 목록)을 먼저 알려준다
    client.send(JSON.stringify(options.hello()));
    for (const status of lastStatusByEngine.values()) client.send(JSON.stringify(status));
    for (const event of eventHistory) client.send(JSON.stringify(event));
    // 히스토리 이후에 보내야 새 클라이언트의 에러 배지가 과거 로그로 오염되지 않는다
    for (const navigation of lastNavigationByEngine.values()) {
      client.send(JSON.stringify(navigation));
    }
    for (const framePacket of lastFramePacketByEngine.values()) client.send(framePacket);
    client.on('message', (raw) => {
      try {
        const command = JSON.parse(String(raw)) as ClientCommand;
        void mirrorCommandToSessions(options.sessions, command);
      } catch {
        // 잘못된 형식의 클라이언트 메시지는 무시 (서버가 죽으면 안 됨)
      }
    });
  });

  const sendToAllClients = (payload: Buffer | string): void => {
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  };

  return new Promise((resolve, reject) => {
    httpServer.once('error', (err) => {
      const isAddrInUse = (err as NodeJS.ErrnoException).code === 'EADDRINUSE';
      reject(
        isAddrInUse
          ? new Error(`Port ${options.port} is already in use — try a different --port`)
          : err,
      );
    });
    httpServer.listen(options.port, () => {
      resolve({
        port: (httpServer.address() as AddressInfo).port,
        broadcastEvent(event: ServerEvent) {
          recordForReplay(event);
          sendToAllClients(JSON.stringify(event));
        },
        broadcastFrame(engine: EngineName, jpeg: Buffer, scrollY: number) {
          const packet = encodeFramePacket(engine, jpeg, scrollY);
          lastFramePacketByEngine.set(engine, packet);
          sendToAllClients(packet);
        },
        close() {
          // httpServer.close()는 열린 소켓이 남아 있으면 대기하므로 클라이언트를 먼저 끊는다
          for (const client of wss.clients) client.terminate();
          wss.close();
          httpServer.close();
        },
      });
    });
  });
}
