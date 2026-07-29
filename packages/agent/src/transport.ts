import type { AgentMessage, SessionEvent, SessionMeta } from '@crosspane/protocol';
import { mergeRepeat } from './repeat.js';

/**
 * `serverUrl` → `/agent` WS 주소. serverUrl의 쿼리는 그대로 옮긴다 —
 * 허브를 네트워크에 노출하면 토큰을 요구하고, 사용자는 그 토큰이 붙은 주소를
 * serverUrl에 그대로 붙여넣는다(`http://ip:7788/?t=…`).
 *
 * URL 파싱에 실패하면 예전처럼 단순 치환으로 떨어진다 — 잘못된 주소로 페이지가
 * 죽는 일은 없어야 한다(호출부가 try/catch로 감싸고 조용히 재시도한다).
 */
function agentUrl(serverUrl: string): string {
  try {
    const url = new URL(serverUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/agent';
    url.hash = '';
    return url.toString();
  } catch {
    return `${serverUrl.replace(/^http/, 'ws')}/agent`;
  }
}

/**
 * 라이브 모드 전송기 — 같은 네트워크의 crosspane 허브로 이벤트를 배칭 전송한다.
 * 원칙: 전송 실패가 페이지에 어떤 영향도 주면 안 된다 (조용한 재접속, 무한 버퍼 금지).
 */
export class LiveTransport {
  private ws: WebSocket | null = null;
  private queue: SessionEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelayMs = 1_000;
  private disposed = false;

  constructor(
    private readonly serverUrl: string,
    private readonly session: SessionMeta,
    private readonly batchIntervalMs = 300,
    private readonly maxQueued = 1_000,
  ) {}

  connect(): void {
    if (this.disposed) return;
    try {
      this.ws = new WebSocket(agentUrl(this.serverUrl));
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws.onopen = () => {
      this.reconnectDelayMs = 1_000;
      this.sendRaw({ type: 'register', session: this.session });
      this.flush();
    };
    this.ws.onclose = () => this.scheduleReconnect();
    this.ws.onerror = () => this.ws?.close();
  }

  enqueue(event: SessionEvent): void {
    // 아직 보내지 않은 마지막 이벤트와 같으면 합친다 — 링버퍼와 같은 이유이고
    // (스팸이 허브 히스토리를 잠식해 원인 이벤트를 밀어낸다) 회선도 아낀다.
    // **보낸 것은 건드리지 않는다** — 큐에 남아 있는 것만 합치므로 이중 계수가 없다
    const merged = mergeRepeat(this.queue[this.queue.length - 1], event);
    if (merged) {
      this.queue[this.queue.length - 1] = merged;
      this.scheduleFlush();
      return;
    }
    this.queue.push(event);
    if (this.queue.length > this.maxQueued) this.queue.shift(); // 서버 부재 시 무한 성장 방지
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, this.batchIntervalMs);
  }

  private flush(): void {
    if (this.queue.length === 0) return;
    if (this.ws?.readyState !== WebSocket.OPEN) return; // 재접속 시 onopen이 다시 flush
    this.sendRaw({ type: 'events', events: this.queue });
    this.queue = [];
  }

  private sendRaw(message: AgentMessage): void {
    try {
      this.ws?.send(JSON.stringify(message));
    } catch {
      // 전송 실패는 페이지에 영향 없어야 한다 — 다음 flush에서 재시도
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed) return;
    setTimeout(() => this.connect(), this.reconnectDelayMs);
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 30_000);
  }

  dispose(): void {
    this.disposed = true;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.ws?.close();
  }
}
