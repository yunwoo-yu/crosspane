import http from 'node:http';
import https from 'node:https';
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
import { lanAddresses } from './addresses.js';
import { debugLog } from './debug.js';
import { resolveDashboardDir, serveDashboardFile } from './static.js';

export interface HubServer {
  /** 실제로 바인딩된 포트. options.port에 0을 주면 OS가 할당한 임의 포트가 들어온다 */
  port: number;
  /** 현재 알려진 세션 (연결 종료 후에도 히스토리 유지분 포함) */
  sessions(): SessionMeta[];
  close(): void;
}

/** 대시보드가 "여기로 붙여라"를 화면에 띄우기 위해 필요한 정보 */
export interface HubInfo {
  port: number;
  /** LAN에 노출됐는지 (--host) — 실기기가 붙을 수 있는지를 결정한다 */
  exposed: boolean;
  /**
   * 에이전트 serverUrl에 넣을 후보 주소. 노출됐으면 LAN IP들, 아니면 localhost.
   * 허브만 이걸 알고 사용자는 대시보드를 보고 있으므로 반드시 화면까지 전달해야 한다
   * (터미널에만 찍으면 놓치고, serverUrl을 잘못 넣어 빈 대시보드를 마주한다 — 실측)
   */
  serverUrls: string[];
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
  /**
   * 접속 토큰. 설정하면 `/ws`·`/agent`·`/capture/:id`·`/hub-info` 전부가 `?t=<토큰>`을
   * 요구한다. **네트워크에 노출할 때는 반드시 켤 것** — 없으면 같은 Wi-Fi의 누구나
   * 세션 로그 전체를 읽고 가짜 세션을 주입할 수 있다(실측).
   *
   * 쿼리로 받는 이유: 브라우저 WebSocket은 헤더를 붙일 수 없다. 그 대가로 토큰이
   * 프록시 로그에 남을 수 있으므로 세션 수명 동안만 유효한 임시값으로 쓴다.
   */
  authToken?: string;
  /**
   * 쓰기 전용 인제스트 키. `/agent`만 통과시키며 **공개돼도 되는 값이다** —
   * 배포된 페이지의 클라이언트에 들어가기 때문이다(공개 페이지가 아는 값은 누구나 안다).
   *
   * 이것이 프로덕션 디버깅을 가능하게 하는 지점이다: 읽기 토큰(`authToken`)은 내 머신에만
   * 남고, 페이지에는 이 키만 실린다. 노출 시 최악은 남이 우리 허브에 쓰레기 세션을 넣는
   * 것이고, 세션 로그를 읽지는 못한다. (Sentry의 DSN 공개 키와 같은 구분)
   */
  ingestKey?: string;
  /** 세션당 히스토리 상한 — 늦게 연 대시보드에 재전송할 이벤트 수 */
  historyLimit?: number;
  /** 종료된 세션을 히스토리째 유지할 최대 개수 (오래된 것부터 폐기) */
  retainedSessions?: number;
  /**
   * TLS 인증서·키 (PEM 내용). 주면 허브가 https/wss로 뜬다.
   *
   * **이것이 `https://` 페이지에서 라이브 모드를 쓰는 유일한 길이다.** 브라우저는 보안
   * 페이지에서 평문 `ws://`를 차단하는데(실측: 연결이 서버에 도달조차 하지 않는다),
   * 우회 수단이 없다 — img·iframe·fetch 모두 같은 mixed content 규칙을 받는다.
   *
   * 인증서를 우리가 만들어 주지 않는 이유: **자체 서명은 이 프로젝트의 타깃에서 원리적으로
   * 통하지 않는다.** Android 7+부터 앱은 사용자가 설치한 CA를 신뢰하지 않으므로
   * (`network_security_config`), 남의 앱 웹뷰에서는 무엇을 설치해도 검증에 실패한다.
   * 그래서 "기기가 이미 신뢰하는 인증서"를 받는 형태여야 한다 — 사내 CA(MDM으로 배포된),
   * 또는 터널·팀 허브가 종단하는 공인 인증서.
   *
   * **사설 IP를 가리키는 공인 인증서는 배포된 페이지에서 소용없다 (실측).** 브라우저는
   * 공개 페이지가 사설 주소로 나가는 것을 네트워크 이전 단계에서 차단한다 — 인증서가
   * 유효해도 서버에 요청이 도달하지 않는다. 즉 `--tls-cert`는 **페이지가 실제로 닿을 수
   * 있는 곳**(같은 사내망, 또는 공개 주소)에 있는 허브를 위한 것이다.
   */
  tls?: { cert: string; key: string };
  /**
   * 에이전트·대시보드에 안내할 외부 주소 (예: `https://xyz.trycloudflare.com`).
   *
   * 허브가 리버스 프록시나 터널 뒤에 있을 때 필요하다 — 그 경우 LAN 주소는 기기에서
   * 닿지 않으므로 안내에 쓰면 안 된다. 이 값이 있으면 `/hub-info`와 `--write-env`가
   * 이것을 쓴다. 터널은 실제 공인 인증서로 종단하므로 `https://` 페이지에서도 동작하고,
   * LTE처럼 같은 네트워크가 아닌 기기에서도 붙는다.
   */
  publicUrl?: string;
  /**
   * 세션이 붙고 끊길 때 호출된다 — CLI가 터미널에 알리기 위한 지점.
   *
   * 왜 필요한가: 지금까지 허브는 기동 후 침묵했다. 에이전트가 붙었는지, 어느 페이지가
   * 로깅되는지 알려면 대시보드를 열어야만 했다. 붙였는데 아무 반응이 없으면 사용자는
   * 주소가 틀렸는지 코드가 안 도는지 구분하지 못한다 — 이 툴에서 가장 흔한 막힘이다.
   */
  onSessionChange?: (event: { kind: 'joined' | 'left'; session: SessionMeta }) => void;
  /** `--lan-tls`가 확보한 호스트명 — `/hub-info`가 안내할 주소가 된다 */
  tlsHostname?: string;
}

const DEFAULT_HISTORY_LIMIT = 2_000;
const DEFAULT_RETAINED_SESSIONS = 10;
// 에이전트 배치 메시지 상한 — 무인증 엔드포인트의 메모리 고갈 방지
const MAX_AGENT_MESSAGE_BYTES = 4 * 1024 * 1024;

/**
 * 읽기 자격 — `?t=` 토큰이 맞는지. 설정되지 않았으면 항상 통과(로컬 전용 기본값).
 *
 * `/ws`·`/capture/:id`·`/hub-info`를 막는다. 이 토큰은 **세션 로그를 읽을 수 있으므로
 * 절대 페이지에 실려선 안 된다** — `isIngestAuthorized` 주석 참조.
 */
export function isAuthorized(url: string | undefined, expected: string | undefined): boolean {
  if (expected === undefined) return true;
  const query = (url ?? '').split('?')[1] ?? '';
  return new URLSearchParams(query).get('t') === expected;
}

/**
 * 쓰기 전용 자격 — `/agent` 수신만 막는다.
 *
 * **읽기와 쓰기를 나눈 이유 (실측):** 공개 배포 페이지에 에이전트를 넣으면 허브 주소가
 * 클라이언트에 들어가고, 공개 페이지가 아는 값은 누구나 안다. 단일 토큰으로 둘을 함께
 * 막던 동안 운영 사이트에 붙이자 **페이지 소스에서 읽기 토큰이 노출됐다** — 그 토큰이면
 * 세션 로그를 읽을 수 있었다. 읽기(`/ws`·`/capture`·`/hub-info`)는 앞으로도 토큰 필수다.
 *
 * **왜 쓰기는 기본이 열림인가:** 공개 페이지에 비밀을 담을 수 없으므로, 앱이 제시할 수
 * 있는 것은 결국 누구나 볼 수 있는 값이다. Sentry가 DSN에 공개 키를 넣는 것은 하나의
 * 인제스트 엔드포인트가 수많은 프로젝트를 받아 **키로 프로젝트를 식별**해야 하기 때문인데,
 * crosspane의 허브는 그 사람 것 하나뿐이라 **주소가 곧 식별자다.** 키는 "추측 어렵게"
 * 외에 하는 일이 없고 그건 호스트명이 이미 한다 — 대신 사용자가 앱 env에 키를 붙여
 * 관리해야 하는 대가가 생긴다. 그 거래는 남는 게 없다.
 *
 * 열려 있을 때의 위험은 **주입뿐이고 읽기가 아니다**: 주소를 아는 사람이 쓰레기 세션을
 * 보낼 수 있고, 많이 보내면 보관 상한(세션 10개) 때문에 내 세션이 밀려날 수 있다.
 * 그게 문제가 되는 상시 팀 허브라면 `--ingest-key`로 닫는다.
 */
export function isIngestAuthorized(
  url: string | undefined,
  ingestKey: string | undefined,
  readToken: string | undefined,
): boolean {
  // 인제스트 키를 설정하지 않았으면 `/agent`는 열려 있다 — 아래 주석의 "왜 기본이 열림인가"
  if (ingestKey === undefined) return true;
  const query = new URLSearchParams((url ?? '').split('?')[1] ?? '');
  if (query.get('k') === ingestKey) return true;
  // 읽기 토큰도 받아 준다 — 기존 사용자의 serverUrl에는 `?t=`가 들어 있다
  return readToken !== undefined && query.get('t') === readToken;
}

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

/**
 * 라벨 → 파일명 어간. `\w`로 정제하면 한국어 라벨('결제 웹뷰')이 통째로 `_`가 된다.
 * 에이전트의 `exportFile()`과 **같은 규칙을 유지할 것** — 라이브 저장과 에이전트
 * export가 같은 이름을 만들어야 한다 (프로토콜은 런타임 코드를 담지 않으므로 각자 보유)
 */
export function captureFileStem(label: string): string {
  const cleaned = label
    .replace(/[^\p{L}\p{N}_-]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return cleaned === '' ? 'session' : cleaned;
}

/**
 * RFC 6266의 content-disposition. **Node의 HTTP 헤더는 non-ASCII를 거부한다**
 * (`TypeError: Invalid character in header content`) — 한국어 라벨을 그대로 넣으면
 * 응답을 쓰는 순간 서버가 던진다. ASCII 폴백과 UTF-8 인코딩 형태를 함께 보낸다.
 */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]+/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export interface AgentUrlOptions {
  port: number;
  /** 허브가 LAN에 노출됐는지 (`--host`) */
  exposed: boolean;
  /** 쓰기 전용 인제스트 키 — 이 주소에 담기는 것은 **이것뿐이다** */
  ingestKey?: string;
  /** 터널·리버스 프록시의 외부 주소 — 있으면 이것만 쓴다 */
  publicUrl?: string;
  scheme: 'http' | 'https';
  /**
   * 인증서가 덮는 호스트명 (`--lan-tls`의 `172-30-1-29.local-ip.sh`).
   *
   * 왜 필요한가: 이 경우 LAN IP를 그대로 안내하면 **인증서 이름이 맞지 않아** 붙지
   * 못한다. 그런데 실패는 조용하다 — 대시보드는 계속 "연결 중…"이고 페이지 쪽에는
   * 아무 표시가 없다. 안내하는 주소는 실제로 붙는 주소여야 한다.
   */
  tlsHostname?: string;
}

/**
 * 에이전트가 붙을 주소 목록. 대시보드 안내(`/hub-info`)와 `--write-env`가 같은 값을 써야
 * 하므로 여기 한 곳에서 만든다.
 *
 * **읽기 토큰(`?t=`)을 여기에 담지 말 것.** 이 주소는 배포된 페이지의 클라이언트로 들어가
 * 페이지 소스에 노출된다(실측). 읽기 토큰이 거기 있으면 누구나 세션 로그를 읽고 가짜
 * 세션을 주입할 수 있다 — 실제로 운영 사이트에 붙였다가 그 상태를 만들었다.
 * 쓰기 전용 인제스트 키(`?k=`)만 담는다.
 *
 * `publicUrl`이 있으면 **그것만** 돌려준다 — 터널 뒤에서는 LAN 주소가 기기에 닿지 않고,
 * 닿지 않는 주소를 함께 보여주면 사용자가 그걸 골라 조용히 실패한다.
 */
export function agentUrls(options: AgentUrlOptions): string[] {
  const query = options.ingestKey ? `/?k=${options.ingestKey}` : '';
  if (options.publicUrl !== undefined && options.publicUrl !== '') {
    return [`${options.publicUrl.replace(/\/+$/, '')}${query}`];
  }
  if (options.tlsHostname !== undefined) {
    return [`${options.scheme}://${options.tlsHostname}:${options.port}${query}`];
  }
  const hosts = options.exposed ? lanAddresses() : ['localhost'];
  return hosts.map((host) => `${options.scheme}://${host}:${options.port}${query}`);
}

interface SessionRecord {
  meta: SessionMeta;
  history: SessionEvent[];
  /** 히스토리 상한으로 버린 이벤트 수 — 캡처 파일이 잘렸음을 밝히는 데 쓴다 */
  dropped: number;
  live: boolean;
  endedAt?: number;
}

export function startHubServer(options: HubServerOptions): Promise<HubServer> {
  const dashboardDir = resolveDashboardDir();
  const host = options.host ?? '127.0.0.1';
  const historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
  const retainedSessions = options.retainedSessions ?? DEFAULT_RETAINED_SESSIONS;

  const authToken = options.authToken;

  const requestListener: http.RequestListener = (req, res) => {
    const pathname = (req.url ?? '').split('?')[0];
    // 정적 파일(대시보드 셸)은 토큰 없이 서빙한다 — 토큰을 넣을 화면 자체를 못 열면
    // 안내가 불가능하다. 세션 데이터가 흐르는 경로만 막는다
    const guarded = pathname === '/hub-info' || pathname.startsWith('/capture/');
    if (guarded && !isAuthorized(req.url, authToken)) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'missing or invalid token (?t=…)' }));
      return;
    }
    // 대시보드가 "에이전트를 여기로 붙여라"를 화면에 띄우기 위한 정보
    if (pathname === '/hub-info') {
      const port = (httpServer.address() as AddressInfo | null)?.port ?? options.port;
      const exposed = host !== '127.0.0.1' && host !== 'localhost';
      const info: HubInfo = {
        port,
        exposed,
        serverUrls: agentUrls({
          port,
          exposed,
          ingestKey: options.ingestKey,
          publicUrl: options.publicUrl,
          scheme: options.tls ? 'https' : 'http',
          tlsHostname: options.tlsHostname,
        }),
      };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(info));
      return;
    }
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
        // 에이전트가 이미 버린 것에 허브가 버린 것을 더한다 — 사용자가 보는 파일 기준
        droppedEvents: record.dropped,
        exportedAt: Date.now(),
      };
      const filename = `${captureFileStem(record.meta.label)}-${record.meta.id}${CAPTURE_FILE_EXTENSION}`;
      res.writeHead(200, {
        'content-type': 'application/json',
        'content-disposition': contentDisposition(filename),
      });
      res.end(JSON.stringify(capture));
      return;
    }
    void serveDashboardFile(dashboardDir, req, res);
  };

  /**
   * TLS를 주면 https 서버로 뜬다. `ws` 패키지는 `noServer: true` + upgrade 이벤트로
   * 붙으므로 두 서버 타입에 그대로 얹힌다 — 아래 배선은 스킴과 무관하다.
   */
  const httpServer = options.tls
    ? https.createServer({ cert: options.tls.cert, key: options.tls.key }, requestListener)
    : http.createServer(requestListener);

  // 세션 상태 — 살아있는 것 + 최근 종료분 (늦게 연 대시보드의 히스토리 재생용)
  const records = new Map<string, SessionRecord>();

  const dashboardWss = new WebSocketServer({ noServer: true });
  const agentWss = new WebSocketServer({ noServer: true });
  // http 서버의 기동 에러(EADDRINUSE 등)가 전파돼도 크래시하지 않도록
  dashboardWss.on('error', () => {});
  agentWss.on('error', () => {});

  httpServer.on('upgrade', (req, socket, head) => {
    const pathname = (req.url ?? '').split('?')[0];
    // 읽기와 쓰기를 다른 자격으로 막는다 — 인제스트 키는 페이지에 실려 공개되므로
    // 그것으로 `/ws`(세션 로그 전량 재생)에 붙을 수 있으면 분리한 의미가 없다
    const permitted =
      pathname === '/agent'
        ? isIngestAuthorized(req.url, options.ingestKey, authToken)
        : isAuthorized(req.url, authToken);
    if (pathname === '/ws' || pathname === '/agent') {
      if (!permitted) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
    }
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
    // 재생 끝 — 접속 직후 질문에 답하는 소비자(crosspane mcp)가 부분 히스토리로
    // 답하지 않도록 경계를 알린다 (`@crosspane/protocol`의 history-complete 주석)
    client.send(JSON.stringify({ type: 'history-complete' } satisfies ServerEvent));
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
          records.set(sessionId, { meta: message.session, history: [], dropped: 0, live: true });
        }
        sendToDashboards({ type: 'session-joined', session: message.session });
        options.onSessionChange?.({ kind: 'joined', session: message.session });
        debugLog('agent', `session registered: ${sessionId} (${message.session.label})`);
        return;
      }
      if (message.type === 'events' && sessionId) {
        const record = records.get(sessionId);
        if (!record) return;
        for (const event of message.events) {
          if (event.sessionId !== sessionId) continue; // 세션 위조 방지
          record.history.push(event);
          if (record.history.length > historyLimit) {
            record.history.shift();
            record.dropped += 1;
          }
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
      if (record) options.onSessionChange?.({ kind: 'left', session: record.meta });
      pruneRetained();
    });
  });

  return new Promise((resolve, reject) => {
    // 포트가 사용 중이면 +1씩 폴백 — 흔한 "이미 떠 있는 다른 도구" 충돌을 조용히 피한다
    const maxAttempts = Math.max(1, options.portAttempts ?? 1);
    let attempt = 0;
    const tryListen = (): void => {
      httpServer.listen(options.port + attempt, host);
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
