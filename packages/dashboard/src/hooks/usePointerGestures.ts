import { useRef } from 'react';
import { DRAG_THRESHOLD_PX, type PointerSample, resolvePointerGesture } from '../input-utils';
import { displayToEngineScale } from '../lib/canvas';
import type { ScrollStreamer } from '../scroll-streamer';
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

/** 클릭 지점 리플 — 왕복을 기다리지 않는 즉각적 시각 피드백 */
function spawnRipple(screen: HTMLElement | null, clientX: number, clientY: number): void {
  if (!screen) return;
  const rect = screen.getBoundingClientRect();
  const ripple = document.createElement('span');
  ripple.className = 'click-ripple';
  ripple.style.left = `${clientX - rect.left}px`;
  ripple.style.top = `${clientY - rect.top}px`;
  screen.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove());
}

type GestureMode = 'pending' | 'scroll' | 'horizontal';

/**
 * 포인터 제스처 — pointermove 중 세로 이동은 **실시간 스크롤 스트리밍**으로
 * 손가락을 즉시 따라가게 하고(로컬 에코), 가로 드래그만 pointerup에서
 * drag 커맨드 하나로 보낸다. 미세 이동은 클릭.
 */
export function usePointerGestures(options: {
  enabled: boolean;
  onGesture: (command: ClientCommand) => void;
  streamer: ScrollStreamer;
  /** 연속 터치 스트리밍 대상 엔진 (Android) — 제스처를 분류하지 않고 그대로 전달한다 */
  touchStreamEngine?: 'android';
  /** 터치 무브의 세로 델타(프레임 px) — 로컬 선행 에코용 */
  onTouchDelta?: (deltaY: number) => void;
  /** 표시 px → 엔진 px 환산용 (1:1 손가락 추적) */
  getCanvas: () => HTMLCanvasElement | null;
  /** pointerdown 시 포커스를 줄 대상 (키 입력 라우팅) */
  focusTarget: React.RefObject<HTMLElement | null>;
}) {
  const { enabled, onGesture, streamer, touchStreamEngine, onTouchDelta, getCanvas, focusTarget } =
    options;
  const startRef = useRef<PointerSample | null>(null);
  const modeRef = useRef<GestureMode>('pending');
  const lastPyRef = useRef(0);
  const lastTouchMoveTsRef = useRef(0);

  if (!enabled) return {};

  // 실기기 연속 터치: 분류 없이 DOWN/MOVE/UP을 그대로 — 탭/스크롤/관성은 기기가 판단한다.
  // 탭이면 다른 엔진에도 click을 미러하되, 이 기기는 제외(네이티브 탭이 이미 처리)
  if (touchStreamEngine) {
    const TOUCH_MOVE_INTERVAL_MS = 15;
    return {
      onPointerDown: (event: React.PointerEvent<HTMLCanvasElement>) => {
        focusTarget.current?.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        const sample = sampleFromPointer(event);
        startRef.current = sample;
        lastPyRef.current = event.clientY;
        lastTouchMoveTsRef.current = 0; // 첫 move는 스로틀 없이 즉시 — slop을 빨리 넘긴다
        onGesture({
          type: 'touch',
          phase: 'down',
          x: sample.nx,
          y: sample.ny,
          engine: touchStreamEngine,
        });
      },
      onPointerMove: (event: React.PointerEvent<HTMLCanvasElement>) => {
        if (!startRef.current) return;
        // 로컬 선행 에코 — 스트림 지연을 기다리지 않고 즉시 화면을 밀어준다
        const canvas = getCanvas();
        const scale = displayToEngineScale(canvas);
        const moveDelta = (lastPyRef.current - event.clientY) * scale;
        lastPyRef.current = event.clientY;
        if (moveDelta !== 0) onTouchDelta?.(moveDelta);
        if (event.timeStamp - lastTouchMoveTsRef.current < TOUCH_MOVE_INTERVAL_MS) return;
        lastTouchMoveTsRef.current = event.timeStamp;
        const sample = sampleFromPointer(event);
        onGesture({
          type: 'touch',
          phase: 'move',
          x: sample.nx,
          y: sample.ny,
          engine: touchStreamEngine,
        });
      },
      onPointerUp: (event: React.PointerEvent<HTMLCanvasElement>) => {
        const start = startRef.current;
        startRef.current = null;
        if (!start) return;
        const end = sampleFromPointer(event);
        onGesture({ type: 'touch', phase: 'up', x: end.nx, y: end.ny, engine: touchStreamEngine });
        const command = resolvePointerGesture(start, end);
        if (command.type === 'click') {
          spawnRipple(event.currentTarget.parentElement, event.clientX, event.clientY);
          onGesture({ ...command, except: touchStreamEngine });
        }
      },
      onPointerCancel: () => {
        if (startRef.current) {
          onGesture({ type: 'touch', phase: 'up', x: 0.5, y: 0.5, engine: touchStreamEngine });
        }
        startRef.current = null;
      },
    };
  }

  return {
    onPointerDown: (event: React.PointerEvent<HTMLCanvasElement>) => {
      focusTarget.current?.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      startRef.current = sampleFromPointer(event);
      modeRef.current = 'pending';
      lastPyRef.current = event.clientY;
    },
    onPointerMove: (event: React.PointerEvent<HTMLCanvasElement>) => {
      const start = startRef.current;
      if (!start) return;
      if (modeRef.current === 'pending') {
        const dx = event.clientX - start.px;
        const dy = event.clientY - start.py;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        // 세로 위주면 실시간 스크롤, 아니면 pointerup에서 가로 드래그로
        modeRef.current = Math.abs(dy) > Math.abs(dx) * 1.2 ? 'scroll' : 'horizontal';
        lastPyRef.current = start.py;
      }
      if (modeRef.current === 'scroll') {
        // 드래그 위로 = 콘텐츠 아래로 (터치 스크롤 방향). 시작 지점 좌표를 실어
        // 엔진이 그 아래의 실제 스크롤 컨테이너를 스크롤하게 한다
        const deltaY = (lastPyRef.current - event.clientY) * displayToEngineScale(getCanvas());
        lastPyRef.current = event.clientY;
        if (deltaY !== 0) streamer.add(deltaY, Date.now(), start.nx, start.ny);
      }
    },
    onPointerUp: (event: React.PointerEvent<HTMLCanvasElement>) => {
      const start = startRef.current;
      startRef.current = null;
      if (!start) return;
      const end = sampleFromPointer(event);
      if (modeRef.current === 'scroll') {
        streamer.flush(); // 남은 델타 즉시 전송
        return;
      }
      const command = resolvePointerGesture(start, end);
      if (command.type === 'click') {
        spawnRipple(event.currentTarget.parentElement, event.clientX, event.clientY);
      }
      onGesture(command);
    },
    onPointerCancel: () => {
      if (modeRef.current === 'scroll') streamer.flush();
      startRef.current = null;
    },
  };
}
