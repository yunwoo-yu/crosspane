import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { encodeFramePacket, encodeVideoPacket } from './frame-packet.js';
import type { ClientCommand, EngineName, HelloEvent, ServerEvent } from './protocol.js';
import type { InputTarget } from './session.js';
import { resolveDashboardDir, serveDashboardFile } from './static.js';

export interface DashboardServer {
  /** 실제로 바인딩된 포트. options.port에 0을 주면 OS가 할당한 임의 포트가 들어온다 */
  port: number;
  broadcastEvent(event: ServerEvent): void;
  broadcastFrame(engine: EngineName, jpeg: Buffer, scrollY: number): void;
  /** 실시간 비디오 스트림 조각 — 캐시하지 않는다 (늦은 접속자는 스트림 재시작으로 키프레임을 받는다) */
  broadcastVideoChunk(engine: EngineName, chunk: Buffer): void;
  close(): void;
}

export interface PaneController {
  startEngine(engine: EngineName): Promise<void>;
  stopEngine(engine: EngineName): Promise<void>;
}

/** 시뮬레이터 셸앱과의 HTTP 브릿지 — 명령 롱폴 / 이벤트·프레임 수신 */
export interface ShellBridge {
  /** 명령이 생길 때까지(또는 타임아웃까지) 대기 후 반환 — 입력 지연을 폴링 주기에서 분리한다 */
  waitForCommands(engine: EngineName): Promise<unknown[]>;
  handleEvent(engine: EngineName, payload: unknown): void;
  /** 셸이 자체 캡처해 push한 프레임(JPEG) — simctl 폴링을 대체한다 */
  handleFrame(engine: EngineName, jpeg: Buffer, scrollY: number): void;
}

export interface DashboardServerOptions {
  port: number;
  /** 포트가 사용 중일 때 +1씩 시도할 최대 횟수 (기본 1 = 폴백 없음) */
  portAttempts?: number;
  hello: () => HelloEvent;
  sessions: ReadonlyMap<EngineName, InputTarget>;
  paneController: PaneController;
  shellBridge?: ShellBridge;
  /** 새 대시보드 접속 시 호출 — 비디오 스트림을 키프레임부터 다시 시작시키는 용도 */
  onClientConnect?: () => void;
}

// 대시보드가 나중에 접속해도 이전 로그를 볼 수 있도록 유지하는 이벤트 개수
const EVENT_HISTORY_LIMIT = 300;
// 네트워크 이벤트는 양이 많아 콘솔 히스토리를 밀어내지 않도록 별도 버퍼를 쓴다
const NETWORK_HISTORY_LIMIT = 600;

/** 미러링 대상 입력 커맨드 (pane 제어 커맨드 제외) */
type MirrorCommand = Exclude<ClientCommand, { type: 'start-engine' } | { type: 'stop-engine' }>;

/** 입력 커맨드 하나를 특정 엔진 세션에 재생한다 */
function applyCommandToSession(session: InputTarget, command: MirrorCommand): Promise<void> {
  switch (command.type) {
    case 'click':
      return session.clickAt(command.x, command.y);
    case 'drag':
      return session.dragBetween(
        command.fromX,
        command.fromY,
        command.toX,
        command.toY,
        command.durationMs,
      );
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
  command: MirrorCommand,
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
    // 셸앱 브릿지: 시뮬레이터의 localhost == 호스트라 같은 서버로 통신한다
    const [pathname, query] = (req.url ?? '').split('?');
    const shellMatch = /^\/shell\/([a-z-]+)\/(commands|event|frame)$/.exec(pathname);
    if (shellMatch && options.shellBridge) {
      const engine = shellMatch[1] as EngineName;
      if (shellMatch[2] === 'frame') {
        // 셸 push 프레임 — 바이너리 JPEG body + scrollY 쿼리(프레임 픽셀 단위)
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          const scrollY = Number(new URLSearchParams(query).get('scrollY') ?? Number.NaN);
          options.shellBridge?.handleFrame(
            engine,
            Buffer.concat(chunks),
            Number.isFinite(scrollY) ? scrollY : -1,
          );
          res.writeHead(204).end();
        });
        return;
      }
      if (shellMatch[2] === 'commands') {
        // 롱폴: 명령이 생기면 즉시, 없으면 브릿지의 타임아웃까지 대기 후 빈 배열 응답
        void options.shellBridge.waitForCommands(engine).then((commands) => {
          if (res.writableEnded) return;
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(commands));
        });
      } else {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          try {
            options.shellBridge?.handleEvent(engine, JSON.parse(body));
          } catch {
            // 잘못된 페이로드 무시
          }
          res.writeHead(204).end();
        });
      }
      return;
    }
    void serveDashboardFile(dashboardDir, req, res);
  });

  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  // http 서버의 EADDRINUSE 등이 wss로도 전파되는데, 핸들러가 없으면
  // unhandled 'error'로 프로세스가 크래시한다. 처리는 httpServer.once('error')가 담당.
  wss.on('error', () => {});

  // 접속 전에 발생한 콘솔/에러/네트워크 이벤트와 마지막 엔진 상태를
  // 새 클라이언트에게 재전송하기 위한 버퍼
  const eventHistory: ServerEvent[] = [];
  const networkHistory: ServerEvent[] = [];
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
      case 'network':
        networkHistory.push(event);
        if (networkHistory.length > NETWORK_HISTORY_LIMIT) networkHistory.shift();
        break;
      case 'engine-status':
        lastStatusByEngine.set(event.engine, event);
        // 중지된 엔진의 마지막 프레임/URL은 더 이상 유효하지 않다 —
        // 늦게 접속한 클라이언트에 죽은 화면이 재생되지 않도록 캐시를 비운다
        if (event.status === 'stopped') {
          lastFramePacketByEngine.delete(event.engine);
          lastNavigationByEngine.delete(event.engine);
        }
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
    for (const event of networkHistory) client.send(JSON.stringify(event));
    // 히스토리 이후에 보내야 새 클라이언트의 에러 배지가 과거 로그로 오염되지 않는다
    for (const navigation of lastNavigationByEngine.values()) {
      client.send(JSON.stringify(navigation));
    }
    for (const framePacket of lastFramePacketByEngine.values()) client.send(framePacket);
    options.onClientConnect?.();
    client.on('message', (raw) => {
      try {
        const command = JSON.parse(String(raw)) as ClientCommand;
        // pane 제어는 세션 미러링이 아니라 라이프사이클 컨트롤러가 처리한다
        if (command.type === 'start-engine') {
          void options.paneController.startEngine(command.engine);
        } else if (command.type === 'stop-engine') {
          void options.paneController.stopEngine(command.engine);
        } else {
          void mirrorCommandToSessions(options.sessions, command);
        }
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
    // 포트가 사용 중이면 +1씩 폴백 — 흔한 "이미 떠 있는 다른 도구" 충돌을 조용히 피한다
    const maxAttempts = Math.max(1, options.portAttempts ?? 1);
    let attempt = 0;
    const tryListen = (): void => {
      httpServer.listen(options.port + attempt);
    };
    httpServer.on('error', (err) => {
      const isAddrInUse = (err as NodeJS.ErrnoException).code === 'EADDRINUSE';
      if (isAddrInUse && attempt + 1 < maxAttempts) {
        attempt += 1;
        tryListen();
        return;
      }
      reject(
        isAddrInUse
          ? new Error(`Port ${options.port} is already in use — try a different --port`)
          : err,
      );
    });
    httpServer.once('listening', () => {
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
        broadcastVideoChunk(engine: EngineName, chunk: Buffer) {
          sendToAllClients(encodeVideoPacket(engine, chunk));
        },
        close() {
          // httpServer.close()는 열린 소켓이 남아 있으면 대기하므로 클라이언트를 먼저 끊는다
          for (const client of wss.clients) client.terminate();
          wss.close();
          httpServer.close();
        },
      });
    });
    tryListen();
  });
}
