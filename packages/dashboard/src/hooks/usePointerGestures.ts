import { useRef } from 'react';
import { type PointerSample, resolvePointerGesture } from '../input-utils';
import type { ClientCommand } from '../types';

function sampleFromPointer(event: React.PointerEvent<HTMLCanvasElement>): PointerSample {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    px: event.clientX,
    py: event.clientY,
    // 화면에 표시된 canvas 크기 ≠ 엔진 뷰포트 크기 — 0~1 정규화로 보낸다
    nx: (event.clientX - rect.left) / rect.width,
    ny: (event.clientY - rect.top) / rect.height,
    ts: event.timeStamp,
  };
}

/**
 * 포인터 제스처 — pointerdown~up 한 쌍을 클릭/드래그로 분류해
 * 하나의 커맨드로 만든다 (분류 규칙은 input-utils의 순수 함수).
 */
export function usePointerGestures(options: {
  enabled: boolean;
  onGesture: (command: ClientCommand) => void;
  /** pointerdown 시 포커스를 줄 대상 (키 입력 라우팅) */
  focusTarget: React.RefObject<HTMLElement | null>;
}) {
  const { enabled, onGesture, focusTarget } = options;
  const gestureStartRef = useRef<PointerSample | null>(null);

  if (!enabled) return {};
  return {
    onPointerDown: (event: React.PointerEvent<HTMLCanvasElement>) => {
      focusTarget.current?.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      gestureStartRef.current = sampleFromPointer(event);
    },
    onPointerUp: (event: React.PointerEvent<HTMLCanvasElement>) => {
      const start = gestureStartRef.current;
      gestureStartRef.current = null;
      if (!start) return;
      onGesture(resolvePointerGesture(start, sampleFromPointer(event)));
    },
    onPointerCancel: () => {
      gestureStartRef.current = null;
    },
  };
}
