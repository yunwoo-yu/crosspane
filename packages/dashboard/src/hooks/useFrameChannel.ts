import { type RefObject, useEffect, useState } from 'react';
import type { PaneScreen } from '../pane-screen';
import type { EngineName, FrameListener } from '../types';

/**
 * 프레임 채널 — 구독한 프레임을 PaneScreen(윈도우/페이지 모드)에 넘긴다.
 * 프레임은 React 상태를 거치지 않는다 (성능 계약).
 */
export function useFrameChannel(options: {
  engine: EngineName;
  /** 숨김 상태(다른 pane 포커스 중)면 구독을 끊어 디코드 비용을 없앤다 */
  visible: boolean;
  subscribeToFrames: (engine: EngineName, listener: FrameListener) => () => void;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  screen: PaneScreen;
}): boolean {
  const { engine, visible, subscribeToFrames, canvasRef, screen } = options;
  const [hasFrame, setHasFrame] = useState(false);

  useEffect(() => {
    if (!visible) return;
    return subscribeToFrames(engine, (frame, scrollY, fullPage = false) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      screen.acceptFrame(canvas, frame, scrollY, fullPage, Date.now());
      setHasFrame(true); // 같은 값이면 React가 리렌더를 생략하므로 매 프레임 호출해도 무해
    });
  }, [engine, subscribeToFrames, visible, canvasRef, screen]);

  return hasFrame;
}
