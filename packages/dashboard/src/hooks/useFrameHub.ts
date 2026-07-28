import { useCallback, useRef } from 'react';
import type { ClientCommand, EngineName, FrameListener } from '../types';

/**
 * 프레임 구독 허브 — 프레임은 React 상태를 거치지 않고 구독자(canvas)에 직접
 * 전달된다 (고프레임 리렌더 비용 0, 성능 계약). 구독 목록 변화는 watch 커맨드로
 * 서버에 알려 안 보는 pane의 캡처를 끈다.
 */
export function useFrameHub(sendCommand: (command: ClientCommand) => void) {
  const listenersRef = useRef(new Map<EngineName, Set<FrameListener>>());

  const hasSubscribers = useCallback((engine: EngineName): boolean => {
    const listeners = listenersRef.current.get(engine);
    return Boolean(listeners && listeners.size > 0);
  }, []);

  /** 디코딩된 프레임(스냅샷/비디오 공통)을 구독자에게 전달하고 close한다 */
  const dispatchFrame = useCallback(
    (
      engine: EngineName,
      frame: ImageBitmap | VideoFrame | ImageData,
      scrollY: number,
      fullPage = false,
    ) => {
      const listeners = listenersRef.current.get(engine);
      if (listeners && listeners.size > 0) {
        for (const listener of listeners) listener(frame, scrollY, fullPage);
      }
      if ('close' in frame) frame.close(); // ImageData는 close 불필요
    },
    [],
  );

  /** 현재 프레임 구독 중인 엔진 목록을 서버에 알린다 — 안 보는 pane은 서버가 캡처를 끈다 */
  const sendWatchedEngines = useCallback(() => {
    const engines = [...listenersRef.current.entries()]
      .filter(([, listeners]) => listeners.size > 0)
      .map(([engine]) => engine);
    sendCommand({ type: 'watch', engines });
  }, [sendCommand]);

  const subscribeToFrames = useCallback(
    (engine: EngineName, listener: FrameListener) => {
      const listenersByEngine = listenersRef.current;
      let listeners = listenersByEngine.get(engine);
      if (!listeners) {
        listeners = new Set();
        listenersByEngine.set(engine, listeners);
      }
      listeners.add(listener);
      sendWatchedEngines();
      return () => {
        listeners.delete(listener);
        sendWatchedEngines();
      };
    },
    [sendWatchedEngines],
  );

  return { hasSubscribers, dispatchFrame, sendWatchedEngines, subscribeToFrames };
}
