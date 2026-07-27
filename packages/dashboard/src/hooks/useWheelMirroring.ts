import { type RefObject, useEffect } from 'react';
import { WHEEL_COALESCE_MS } from '../constants';
import { applyEchoOffset } from '../lib/canvas';
import type { ScrollEcho } from '../scroll-echo';
import type { ClientCommand } from '../types';

/**
 * 휠 미러링 — React onWheel은 passive라 preventDefault가 불가능하므로
 * non-passive 네이티브 리스너로 대시보드 자체 스크롤을 막고,
 * 델타를 WHEEL_COALESCE_MS 동안 모아 하나의 scroll 커맨드로 보낸다.
 * 로컬 에코: 서버 왕복을 기다리지 않고 canvas를 즉시 이동시킨다.
 */
export function useWheelMirroring(options: {
  enabled: boolean;
  screenRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  echo: ScrollEcho;
  sendCommand: (command: ClientCommand) => void;
}): void {
  const { enabled, screenRef, canvasRef, echo, sendCommand } = options;

  useEffect(() => {
    if (!enabled) return;
    const screen = screenRef.current;
    if (!screen) return;
    let accumulatedDeltaY = 0;
    let flushTimer: number | null = null;

    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault();
      accumulatedDeltaY += event.deltaY;
      const canvas = canvasRef.current;
      if (canvas) applyEchoOffset(canvas, echo.addWheelDelta(event.deltaY, Date.now()));

      if (flushTimer === null) {
        flushTimer = window.setTimeout(() => {
          const deltaY = Math.round(accumulatedDeltaY);
          accumulatedDeltaY = 0;
          flushTimer = null;
          if (deltaY !== 0) sendCommand({ type: 'scroll', deltaY });
        }, WHEEL_COALESCE_MS);
      }
    };

    screen.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      screen.removeEventListener('wheel', handleWheel);
      if (flushTimer !== null) window.clearTimeout(flushTimer);
    };
  }, [enabled, screenRef, canvasRef, echo, sendCommand]);
}
