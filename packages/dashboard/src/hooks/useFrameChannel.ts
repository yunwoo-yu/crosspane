import { type RefObject, useEffect, useState } from 'react';
import { applyEchoOffset } from '../lib/canvas';
import type { ScrollEcho } from '../scroll-echo';
import type { EngineName, FrameListener } from '../types';

/**
 * 프레임 채널 — 구독한 프레임을 canvas에 직접 그리고(React 상태 미경유),
 * 프레임의 scrollY를 에코 상태 기계에 넘겨 수렴 오프셋만 적용한다.
 */
export function useFrameChannel(options: {
  engine: EngineName;
  /** 숨김 상태(다른 pane 포커스 중)면 구독을 끊어 디코드 비용을 없앤다 */
  visible: boolean;
  subscribeToFrames: (engine: EngineName, listener: FrameListener) => () => void;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  echo: ScrollEcho;
}): boolean {
  const { engine, visible, subscribeToFrames, canvasRef, echo } = options;
  const [hasFrame, setHasFrame] = useState(false);

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
      applyEchoOffset(canvas, echo.reconcileFrame(scrollY, Date.now()));
    });
  }, [engine, subscribeToFrames, visible, canvasRef, echo]);

  return hasFrame;
}
