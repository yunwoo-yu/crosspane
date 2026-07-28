import type { SessionEvent } from '@crosspane/protocol';

/**
 * 크래시 내성 링버퍼 — "죽기 직전까지"를 남기는 것이 이 SDK의 존재 이유다.
 * 페이지가 하드 크래시하면 에이전트도 함께 죽으므로, 이벤트는 도착 즉시
 * 여기 쌓이고 export는 언제든 마지막 N개를 돌려준다.
 */
export class RingBuffer {
  private events: SessionEvent[] = [];
  private dropped = 0;

  constructor(private readonly capacity: number) {}

  push(event: SessionEvent): void {
    this.events.push(event);
    if (this.events.length > this.capacity) {
      this.events.shift();
      this.dropped += 1;
    }
  }

  snapshot(): SessionEvent[] {
    return [...this.events];
  }

  /** 상한 초과로 버린 이벤트 수 — export 시 "잘렸음"을 알리는 데 쓴다 */
  get droppedCount(): number {
    return this.dropped;
  }

  get size(): number {
    return this.events.length;
  }
}
