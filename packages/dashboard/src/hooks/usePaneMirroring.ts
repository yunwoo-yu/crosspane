import { useRef } from 'react';
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
  screenStateRef.current ??= new PaneScreen(viewport);
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
  useWheelMirroring({
    enabled: !viewOnly,
    screenRef,
    streamer: streamerRef.current,
  });
  const canvasHandlers = usePointerGestures({
    enabled: !viewOnly,
    // 클릭은 전 엔진 미러(한 번 입력, 모두 반영), 드래그(가로)는 이 pane만
    onGesture: (command) =>
      stableSendRef.current(command.type === 'drag' ? { ...command, engine } : command),
    streamer: streamerRef.current,
    getCanvas: () => canvasRef.current,
    focusTarget: keyInputRef,
  });
  const keyInputHandlers = useKeyboardMirroring({ sendCommand: stableSendRef.current });

  const attachCanvas = (canvas: HTMLCanvasElement | null): void => {
    canvasRef.current = canvas;
    registerCanvas?.(engine, canvas);
  };

  return { screenRef, keyInputRef, attachCanvas, hasFrame, canvasHandlers, keyInputHandlers };
}
