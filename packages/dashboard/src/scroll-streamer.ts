import { WHEEL_COALESCE_MS } from './constants';
import type { ClientCommand } from './types';

/**
 * 스크롤 델타 스트리머 — 휠/드래그 공용.
 * 델타를 로컬 렌더러(applyLocal)에 즉시 반영하고(체감 0ms),
 * WHEEL_COALESCE_MS 동안 모아 하나의 scroll 커맨드로 보낸다 (백로그 방지).
 */
export interface ScrollStreamer {
  add(deltaY: number, now: number): void;
  /** 제스처 종료 등 — 모인 델타를 즉시 전송 */
  flush(): void;
  dispose(): void;
}

export function createScrollStreamer(options: {
  sendCommand: (command: ClientCommand) => void;
  /** 로컬 즉시 반영 (PaneScreen.scrollBy) */
  applyLocal: (deltaY: number, now: number) => void;
}): ScrollStreamer {
  let accumulated = 0;
  let timer: number | null = null;

  const send = (): void => {
    const deltaY = Math.round(accumulated);
    accumulated = 0;
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    if (deltaY !== 0) options.sendCommand({ type: 'scroll', deltaY });
  };

  return {
    add(deltaY, now) {
      accumulated += deltaY;
      options.applyLocal(deltaY, now);
      if (timer === null) timer = window.setTimeout(send, WHEEL_COALESCE_MS);
    },
    flush: send,
    dispose() {
      if (timer !== null) window.clearTimeout(timer);
    },
  };
}
