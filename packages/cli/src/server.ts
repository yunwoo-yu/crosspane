import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  type AgentMessage,
  CAPTURE_FILE_EXTENSION,
  CAPTURE_FILE_VERSION,
  type ServerEvent,
  type SessionCapture,
  type SessionEvent,
  type SessionMeta,
} from '@crosspane/protocol';
import { WebSocket, WebSocketServer } from 'ws';
import { debugLog } from './debug.js';
import { resolveDashboardDir, serveDashboardFile } from './static.js';

export interface HubServer {
  /** 실제로 바인딩된 포트. options.port에 0을 주면 OS가 할당한 임의 포트가 들어온다 */
  port: number;
  /** 현재 알려진 세션 (연결 종료 후에도 히스토리 유지분 포함) */
  sessions(): SessionMeta[];
  close(): void;
}

export interface HubServerOptions {
  port: number;
  /** 포트가 사용 중일 때 +1씩 시도할 최대 횟수 (기본 1 = 폴백 없음) */
  portAttempts?: number;
  /**
   * 바인드 주소 (기본 127.0.0.1). 실기기의 라이브 에이전트를 받으려면
   * --host로 명시적으로 노출해야 한다 — 세션 데이터가 흐르는 채널이므로 기본 비노출.
   */
  host?: string;
  /** 세션당 히스토리 상한 — 늦게 연 대시보드에 재전송할 이벤트 수 */
  historyLimit?: number;
  /** 종료된 세션을 히스토리째 유지할 최대 개수 (오래된 것부터 폐기) */
  retainedSessions?: number;
}

const DEFAULT_HISTORY_LIMIT = 2_000;
const DEFAULT_RETAINED_SESSIONS = 10;
// 에이전트 배치 메시지 상한 — 무인증 엔드포인트의 메모리 고갈 방지
const MAX_AGENT_MESSAGE_BYTES = 4 * 1024 * 1024;

/**
 * 대시보드 WS Origin 검증 — 크로스사이트 WebSocket 하이재킹으로 세션 로그가
 * 새는 것을 막는다. 루프백이거나 대시보드를 연 호스트(Host 헤더)와 같아야 한다.
 * (에이전트 채널은 검증하지 않는다 — 실기기 페이지의 Origin은 임의이며,
 * 노출 자체가 --host 옵트인으로 제어된다)
 */
export function isAllowedWsOrigin(
  origin: string | undefined,
  hostHeader: string | undefined,
): boolean {
  if (origin === undefined) return true; // 비브라우저 클라이언트(스모크/CLI)는 Origin이 없다
  try {
    const parsed = new URL(origin);
    const hostname = parsed.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') return true;
    return hostHeader !== undefined && parsed.host === hostHeader;
  } catch {
    return false;
  }
}

interface SessionRecord {
  meta: SessionMeta;
  history: SessionEvent[];
  live: boolean;
  endedAt?: number;
}

export function startHubServer(options: HubServerOptions): Promise<HubServer> {
  const dashboardDir = resolveDashboardDir();
  const historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
  const retainedSessions = options.retainedSessions ?? DEFAULT_RETAINED_SESSIONS;

  const httpServer = http.createServer((req, res) => {
    const pathname = (req.url ?? '').split('?')[0];
    // 라이브로 보고 있는 세션을 파일로 저장한다. 허브가 원본 이벤트를 갖고 있으므로
    // 대시보드가 표시용 엔트리를 역변환하는 것보다 정확하다(배칭·상한 손실 없음)
    const captureMatch = /^\/capture\/([\w-]+)$/.exec(pathname);
    if (captureMatch) {
      const record = records.get(captureMatch[1]);
      if (!record) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'unknown session' }));
        return;
      }
      const capture: SessionCapture = {
        version: CAPTURE_FILE_VERSION,
        session: record.meta,
        events: record.history,
        exportedAt: Date.now(),
      };
      const filename = `${record.meta.label.replace(/[^\w-]+/g, '_')}-${record.meta.id}${CAPTURE_FILE_EXTENSION}`;
      res.writeHead(200, {
        'content-type': 'application/json',
        'content-disposition': `attachment; filename="${filename}"`,
      });
      res.end(JSON.stringify(capture));
      return;
    }
    void serveDashboardFile(dashboardDir, req, res);
  });

  // 세션 상태 — 살아있는 것 + 최근 종료분 (늦게 연 대시보드의 히스토리 재생용)
  const records = new Map<string, SessionRecord>();

  const dashboardWss = new WebSocketServer({ noServer: true });
  const agentWss = new WebSocketServer({ noServer: true });
  // http 서버의 기동 에러(EADDRINUSE 등)가 전파돼도 크래시하지 않도록
  dashboardWss.on('error', () => {});
  agentWss.on('error', () => {});

  httpServer.on('upgrade', (req, socket, head) => {
    const pathname = (req.url ?? '').split('?')[0];
    if (pathname === '/ws') {
      if (!isAllowedWsOrigin(req.headers.origin, req.headers.host)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      dashboardWss.handleUpgrade(req, socket, head, (client) => {
        dashboardWss.emit('connection', client, req);
      });
    } else if (pathname === '/agent') {
      agentWss.handleUpgrade(req, socket, head, (client) => {
        agentWss.emit('connection', client, req);
      });
    } else {
      socket.destroy();
    }
  });

  const sendToDashboards = (event: ServerEvent): void => {
    const payload = JSON.stringify(event);
    for (const client of dashboardWss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  };

  const pruneRetained = (): void => {
    const ended = [...records.values()]
      .filter((record) => !record.live)
      .sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0));
    while (ended.length > retainedSessions) {
      const oldest = ended.shift();
      if (oldest) records.delete(oldest.meta.id);
    }
  };

  // ── 대시보드 채널 ──────────────────────────────────────────────
  dashboardWss.on('connection', (client) => {
    // 현재 세션 목록 → 세션별 히스토리 순서로 재생 (라이브 이벤트는 그 뒤에 흐른다)
    const sessions = [...records.values()].map((record) => record.meta);
    client.send(JSON.stringify({ type: 'hello', sessions } satisfies ServerEvent));
    for (const record of records.values()) {
      for (const event of record.history) client.send(JSON.stringify(event));
      if (!record.live) {
        client.send(
          JSON.stringify({
            type: 'session-left',
            sessionId: record.meta.id,
            ts: record.endedAt ?? Date.now(),
          } satisfies ServerEvent),
        );
      }
    }
    // 대시보드 → 서버 방향 커맨드는 현재 없다 — 미지의 메시지는 조용히 무시
    client.on('message', () => {});
  });

  // ── 에이전트 채널 ──────────────────────────────────────────────
  agentWss.on('connection', (agent) => {
    let sessionId: string | null = null;
    agent.on('message', (raw) => {
      const size = Buffer.isBuffer(raw) ? raw.length : String(raw).length;
      if (size > MAX_AGENT_MESSAGE_BYTES) {
        agent.terminate();
        return;
      }
      let message: AgentMessage;
      try {
        message = JSON.parse(String(raw)) as AgentMessage;
      } catch {
        return; // 잘못된 페이로드는 무시 — 서버가 죽으면 안 됨
      }
      if (message.type === 'register' && message.session?.id) {
        sessionId = message.session.id;
        // 재접속(같은 id)이면 히스토리를 이어간다 — 웹뷰 백그라운드 복귀 대응
        const existing = records.get(sessionId);
        if (existing) {
          existing.live = true;
          existing.endedAt = undefined;
        } else {
          records.set(sessionId, { meta: message.session, history: [], live: true });
        }
        sendToDashboards({ type: 'session-joined', session: message.session });
        debugLog('agent', `session registered: ${sessionId} (${message.session.label})`);
        return;
      }
      if (message.type === 'events' && sessionId) {
        const record = records.get(sessionId);
        if (!record) return;
        for (const event of message.events) {
          if (event.sessionId !== sessionId) continue; // 세션 위조 방지
          record.history.push(event);
          if (record.history.length > historyLimit) record.history.shift();
          sendToDashboards(event);
        }
      }
    });
    agent.on('close', () => {
      if (!sessionId) return;
      const record = records.get(sessionId);
      if (record) {
        record.live = false;
        record.endedAt = Date.now();
      }
      sendToDashboards({ type: 'session-left', sessionId, ts: Date.now() });
      pruneRetained();
    });
  });

  return new Promise((resolve, reject) => {
    // 포트가 사용 중이면 +1씩 폴백 — 흔한 "이미 떠 있는 다른 도구" 충돌을 조용히 피한다
    const maxAttempts = Math.max(1, options.portAttempts ?? 1);
    let attempt = 0;
    const tryListen = (): void => {
      httpServer.listen(options.port + attempt, options.host ?? '127.0.0.1');
    };
    const onStartupError = (err: Error): void => {
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
    };
    httpServer.on('error', onStartupError);
    httpServer.once('listening', () => {
      // 기동 핸들러는 여기서 임무 종료 — 그대로 두면 listen 이후의 서버 에러가
      // 이미 resolve된 Promise의 reject로 흘러가 완전히 무음 처리된다
      httpServer.removeListener('error', onStartupError);
      httpServer.on('error', (err) => console.error(`[crosspane] server error: ${String(err)}`));
      resolve({
        port: (httpServer.address() as AddressInfo).port,
        sessions: () => [...records.values()].map((record) => record.meta),
        close() {
          for (const client of dashboardWss.clients) client.terminate();
          for (const client of agentWss.clients) client.terminate();
          dashboardWss.close();
          agentWss.close();
          httpServer.close();
        },
      });
    });
    tryListen();
  });
}
