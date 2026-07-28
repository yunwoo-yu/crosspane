import { useCallback, useEffect, useRef } from 'react';
import { PaneScreen } from '../pane-screen';
import { createScrollStreamer, type ScrollStreamer } from '../scroll-streamer';
import type { ClientCommand, EngineName, FrameListener } from '../types';
import { useFrameChannel } from './useFrameChannel';
import { useKeyboardMirroring } from './useKeyboardMirroring';
import { usePointerGestures } from './usePointerGestures';
import { useWheelMirroring } from './useWheelMirroring';

export interface PaneMirroringOptions {
  engine: EngineName;
  /** 엔진 뷰포트 (CSS px) — 풀페이지 프레임의 표시 크롭 높이 계산용 */
  viewport: { width: number; height: number };
  /** 숨김 상태(다른 pane 포커스 중)면 프레임 구독을 끊는다 */
  visible: boolean;
  /** 입력 미러링 불가 pane — 입력 핸들러를 붙이지 않는다 */
  viewOnly: boolean;
  subscribeToFrames: (engine: EngineName, listener: FrameListener) => () => void;
  sendCommand: (command: ClientCommand) => void;
  registerCanvas?: (engine: EngineName, canvas: HTMLCanvasElement | null) => void;
}

/**
 * pane 미러링 조립부 — 책임별 훅(프레임/휠/제스처/키보드)을 하나의 API로 묶는다.
 * 휠과 프레임이 공유하는 스크롤 에코 상태는 ScrollEcho(순수 모듈) 인스턴스가 소유한다.
 */
export function usePaneMirroring({
  engine,
  viewport,
  visible,
  viewOnly,
  subscribeToFrames,
  sendCommand,
  registerCanvas,
}: PaneMirroringOptions) {
  const screenRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const keyInputRef = useRef<HTMLInputElement | null>(null);
  const screenStateRef = useRef<PaneScreen | null>(null);
  // Android(비디오 지연 ~0.5s, scrollY 미상)는 상대 에코(시간 감쇠)로 선행 표시,
  // 나머지는 절대 에코(scrollY 정합)
  // 실기기 pane은 상대 에코 — 내부 스크롤 시 절대(scrollY 정합) 에코는 셸 리포트가
  // 메인 스크롤뷰 기준이라 매 프레임 리셋돼 무효가 된다 (한 박자 늦는 체감의 원인)
  screenStateRef.current ??= new PaneScreen(
    viewport,
    engine === 'android' || engine === 'ios-sim' ? 'relative' : 'absolute',
  );
  const sendCommandRef = useRef(sendCommand);
  sendCommandRef.current = sendCommand;
  const stableSendRef = useRef((command: ClientCommand) => sendCommandRef.current(command));
  // 휠/드래그 공용 스크롤 스트리머 — 로컬 즉시 반영 + 코얼레싱 전송
  const streamerRef = useRef<ScrollStreamer | null>(null);
  streamerRef.current ??= createScrollStreamer({
    // 스크롤은 pane 독립 — 이 pane의 엔진에만 보낸다 (엔진별 스크롤 물리가 달라
    // 미러링하면 위치가 어긋나고, Android는 스와이프 재생이 탭으로 오인되기도 한다)
    sendCommand: (command) =>
      stableSendRef.current(command.type === 'scroll' ? { ...command, engine } : command),
    applyLocal: (deltaY, now) => {
      const canvas = canvasRef.current;
      if (canvas) screenStateRef.current?.scrollBy(canvas, deltaY, now);
    },
  });

  const hasFrame = useFrameChannel({
    engine,
    visible,
    subscribeToFrames,
    canvasRef,
    screen: screenStateRef.current,
  });
  // 식별자 고정 — 인라인 화살표면 deps가 매 렌더 바뀌어 휠의 non-passive
  // 리스너가 렌더마다 remove/add를 반복한다 (pane-screen div는 항상 렌더되므로
  // 첫 effect 실행 시점에 screenRef가 비어 있을 걱정은 없다)
  const getCanvas = useCallback(() => canvasRef.current, []);
  useWheelMirroring({
    enabled: !viewOnly,
    screenRef,
    streamer: streamerRef.current,
    getCanvas,
  });
  const canvasHandlers = usePointerGestures({
    enabled: !viewOnly,
    touchStreamEngine: engine === 'android' ? 'android' : undefined,
    onTouchDelta: (deltaY) => {
      const canvas = canvasRef.current;
      if (canvas) screenStateRef.current?.scrollBy(canvas, deltaY, Date.now());
    },
    // 클릭은 전 엔진 미러(한 번 입력, 모두 반영), 드래그(가로)는 이 pane만
    onGesture: (command) =>
      stableSendRef.current(command.type === 'drag' ? { ...command, engine } : command),
    streamer: streamerRef.current,
    getCanvas,
    focusTarget: keyInputRef,
  });
  const keyInputHandlers = useKeyboardMirroring({ sendCommand: stableSendRef.current });

  // pane 언마운트(엔진 stop/포커스 전환) 시 코얼레싱 타이머를 끊는다 —
  // 안 끊으면 최대 WHEEL_COALESCE_MS 뒤 사라진 pane의 scroll 커맨드가 나간다
  useEffect(() => () => streamerRef.current?.dispose(), []);

  // ref 콜백이 렌더마다 새로 만들어지면 React가 ref(null)→ref(node)를 반복해
  // paneCanvasesRef 등록이 매 렌더 detach/attach를 반복한다 — 식별자를 고정한다
  const attachCanvas = useCallback(
    (canvas: HTMLCanvasElement | null): void => {
      canvasRef.current = canvas;
      registerCanvas?.(engine, canvas);
    },
    [engine, registerCanvas],
  );

  return { screenRef, keyInputRef, attachCanvas, hasFrame, canvasHandlers, keyInputHandlers };
}
