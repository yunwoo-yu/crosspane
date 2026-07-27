import { useEffect, useRef, useState } from 'react';
import { WHEEL_COALESCE_MS } from '../constants';
import { type PointerSample, resolvePointerGesture } from '../input-utils';
import type { ClientCommand, EngineName, FrameListener } from '../types';

/** 그대로 엔진에 전달할 특수 키 (나머지 문자는 input/composition 경유 type 커맨드) */
const FORWARDED_SPECIAL_KEYS = new Set([
  'Enter',
  'Backspace',
  'Delete',
  'Tab',
  'Escape',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

// 이 시간 동안 휠 입력이 없으면 로컬 에코를 해제하고 실제 프레임 위치로 스냅한다
const ECHO_RELEASE_AFTER_MS = 400;

/** 로컬 에코 오프셋(엔진 CSS px)을 표시 px로 환산해 canvas에 적용한다 */
function applyEchoOffset(canvas: HTMLCanvasElement, offsetPx: number): void {
  if (canvas.height === 0) return;
  const clamped = Math.max(-canvas.height, Math.min(canvas.height, offsetPx));
  const displayScale = canvas.clientHeight / canvas.height;
  canvas.style.transform = clamped === 0 ? '' : `translateY(${-clamped * displayScale}px)`;
}

export interface PaneMirroringOptions {
  engine: EngineName;
  /** 숨김 상태(다른 pane 포커스 중)면 프레임 구독을 끊는다 */
  visible: boolean;
  /** 입력 미러링 불가 pane — 입력 핸들러를 붙이지 않는다 */
  viewOnly: boolean;
  subscribeToFrames: (engine: EngineName, listener: FrameListener) => () => void;
  sendCommand: (command: ClientCommand) => void;
  registerCanvas?: (engine: EngineName, canvas: HTMLCanvasElement | null) => void;
}

/**
 * pane 한 장의 미러링 전부 — 프레임 렌더링(+스크롤 로컬 에코), 휠 코얼레싱,
 * 클릭/드래그 제스처, 키/IME 입력을 묶어 EnginePane을 표현 컴포넌트로 유지한다.
 *
 * 성능 계약: 프레임은 React 상태를 거치지 않고 canvas에 직접 그린다.
 */
export function usePaneMirroring({
  engine,
  visible,
  viewOnly,
  subscribeToFrames,
  sendCommand,
  registerCanvas,
}: PaneMirroringOptions) {
  const screenRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const keyInputRef = useRef<HTMLInputElement | null>(null);
  const sendCommandRef = useRef(sendCommand);
  sendCommandRef.current = sendCommand;
  const [hasFrame, setHasFrame] = useState(false);

  // 로컬 에코(스크롤 예측): localTarget = 사용자가 의도한 scrollY,
  // lastFrameScrollY = 프레임이 반영한 실제 scrollY.
  // 오프셋 = localTarget - lastFrameScrollY → 프레임이 따라오면 자연히 0으로 수렴한다.
  const localTargetRef = useRef<number | null>(null);
  const lastFrameScrollYRef = useRef<number | null>(null);
  const lastWheelTsRef = useRef(0);
  // 진행 중인 포인터 제스처의 시작 샘플 (pointerup에서 click/drag로 분류)
  const gestureStartRef = useRef<PointerSample | null>(null);

  // 프레임 구독 → canvas 직접 그리기 + 에코 수렴
  useEffect(() => {
    if (!visible) return;
    return subscribeToFrames(engine, (frame, scrollY) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (canvas.width !== frame.width || canvas.height !== frame.height) {
        canvas.width = frame.width;
        canvas.height = frame.height;
      }
      canvas.getContext('2d')?.drawImage(frame, 0, 0);
      setHasFrame(true); // 같은 값이면 React가 리렌더를 생략하므로 매 프레임 호출해도 무해

      if (scrollY < 0) {
        // 스크롤 위치를 모르는 프레임(실기기 pane) — 에코 없이 그대로 표시
        canvas.style.transform = '';
        return;
      }
      lastFrameScrollYRef.current = scrollY;
      const target = localTargetRef.current;
      const wheelIdle = Date.now() - lastWheelTsRef.current > ECHO_RELEASE_AFTER_MS;
      if (target === null || wheelIdle || Math.abs(target - scrollY) < 2) {
        // 스크롤이 끝났거나 프레임이 목표를 따라잡음 — 실제 위치로 스냅
        localTargetRef.current = null;
        canvas.style.transform = '';
      } else {
        // 프레임이 아직 뒤에 있음 — 남은 차이만큼만 에코 유지 (고무줄 현상 방지)
        applyEchoOffset(canvas, target - scrollY);
      }
    });
  }, [engine, subscribeToFrames, visible]);

  // 휠: React onWheel은 passive라 preventDefault 불가 — non-passive 네이티브 리스너로
  // 대시보드 자체 스크롤을 막고, 델타를 코얼레싱해 하나의 커맨드로 보낸다.
  useEffect(() => {
    if (viewOnly) return;
    const screen = screenRef.current;
    if (!screen) return;
    let accumulatedDeltaY = 0;
    let flushTimer: number | null = null;

    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault();
      accumulatedDeltaY += event.deltaY;
      lastWheelTsRef.current = Date.now();

      const canvas = canvasRef.current;
      if (canvas) {
        if (localTargetRef.current === null) {
          localTargetRef.current = lastFrameScrollYRef.current ?? 0;
        }
        localTargetRef.current = Math.max(0, localTargetRef.current + event.deltaY);
        applyEchoOffset(canvas, localTargetRef.current - (lastFrameScrollYRef.current ?? 0));
      }

      if (flushTimer === null) {
        flushTimer = window.setTimeout(() => {
          const deltaY = Math.round(accumulatedDeltaY);
          accumulatedDeltaY = 0;
          flushTimer = null;
          if (deltaY !== 0) sendCommandRef.current({ type: 'scroll', deltaY });
        }, WHEEL_COALESCE_MS);
      }
    };

    screen.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      screen.removeEventListener('wheel', handleWheel);
      if (flushTimer !== null) window.clearTimeout(flushTimer);
    };
  }, [viewOnly]);

  const sampleFromPointer = (event: React.PointerEvent<HTMLCanvasElement>): PointerSample => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      px: event.clientX,
      py: event.clientY,
      // 화면에 표시된 canvas 크기 ≠ 엔진 뷰포트 크기 — 0~1 정규화로 보낸다
      nx: (event.clientX - rect.left) / rect.width,
      ny: (event.clientY - rect.top) / rect.height,
      ts: event.timeStamp,
    };
  };

  const canvasHandlers = viewOnly
    ? {}
    : {
        onPointerDown: (event: React.PointerEvent<HTMLCanvasElement>) => {
          // 클릭한 pane의 숨김 input에 포커스 — 이후 키 입력(IME 포함)이 엔진으로 간다
          keyInputRef.current?.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          gestureStartRef.current = sampleFromPointer(event);
        },
        onPointerUp: (event: React.PointerEvent<HTMLCanvasElement>) => {
          const start = gestureStartRef.current;
          gestureStartRef.current = null;
          if (!start) return;
          // 이동 거리로 클릭/드래그(스와이프)를 분류해 하나의 커맨드로 보낸다
          sendCommandRef.current(resolvePointerGesture(start, sampleFromPointer(event)));
        },
        onPointerCancel: () => {
          gestureStartRef.current = null;
        },
      };

  const keyInputHandlers = {
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
      // OS/브라우저 단축키(cmd+r 등)는 대시보드에 남긴다
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // IME 조합 중의 키 이벤트(key === 'Process' 등)는 조합 완료가 처리한다
      if (event.nativeEvent.isComposing) return;
      if (FORWARDED_SPECIAL_KEYS.has(event.key)) {
        event.preventDefault();
        sendCommandRef.current({ type: 'keypress', key: event.key });
      }
    },
    onInput: (event: React.FormEvent<HTMLInputElement>) => {
      const native = event.nativeEvent as InputEvent;
      // 조합 중간 상태와 조합 유래 input(Safari는 compositionend 후에도 발생)은
      // compositionend 핸들러가 담당한다 — 여기서 보내면 중복 전송된다
      if (native.isComposing || native.inputType?.startsWith('insertComposition')) return;
      if (native.inputType === 'insertFromComposition') return;
      if (native.data) sendCommandRef.current({ type: 'type', text: native.data });
      event.currentTarget.value = '';
    },
    onCompositionEnd: (event: React.CompositionEvent<HTMLInputElement>) => {
      // 한글 등 조합형 입력 — 조합이 확정된 음절만 전송
      if (event.data) sendCommandRef.current({ type: 'type', text: event.data });
      event.currentTarget.value = '';
    },
  };

  const attachCanvas = (canvas: HTMLCanvasElement | null): void => {
    canvasRef.current = canvas;
    registerCanvas?.(engine, canvas);
  };

  return { screenRef, keyInputRef, attachCanvas, hasFrame, canvasHandlers, keyInputHandlers };
}
