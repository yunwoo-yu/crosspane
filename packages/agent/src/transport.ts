import type { AgentMessage, SessionEvent, SessionMeta } from '@crosspane/protocol';

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
      this.ws = new WebSocket(`${this.serverUrl.replace(/^http/, 'ws')}/agent`);
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
    this.queue.push(event);
    if (this.queue.length > this.maxQueued) this.queue.shift(); // 서버 부재 시 무한 성장 방지
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flush();
      }, this.batchIntervalMs);
    }
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
