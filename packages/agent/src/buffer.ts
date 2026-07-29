import type { SessionEvent } from '@crosspane/protocol';
import { mergeRepeat } from './repeat.js';

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
    const merged = mergeRepeat(this.events[this.events.length - 1], event);
    if (merged) {
      // 새 객체로 교체한다 — 같은 이벤트 객체가 전송 큐에도 들어가 있으므로
      // 제자리에서 고치면 전송 측 카운트와 이중으로 세어진다
      this.events[this.events.length - 1] = merged;
      return;
    }
    this.events.push(event);
    if (this.events.length > this.capacity) {
      this.events.shift();
      this.dropped += 1;
    }
  }

  snapshot(): SessionEvent[] {
    return [...this.events];
  }

  /** 상한 초과로 버린 이벤트 수 — 캡처 파일의 `droppedEvents`로 나간다 */
  get droppedCount(): number {
    return this.dropped;
  }
}
