import { type RefObject, useEffect } from 'react';
import type { ScrollStreamer } from '../scroll-streamer';

/**
 * 휠 미러링 — React onWheel은 passive라 preventDefault가 불가능하므로
 * non-passive 네이티브 리스너로 대시보드 자체 스크롤을 막고,
 * 델타를 스트리머(로컬 에코 + 코얼레싱)로 흘린다.
 */
export function useWheelMirroring(options: {
  enabled: boolean;
  screenRef: RefObject<HTMLDivElement | null>;
  streamer: ScrollStreamer;
  /** 표시 px → 엔진(프레임) px 환산 — 드래그 제스처와 단위를 통일한다 */
  getCanvas: () => HTMLCanvasElement | null;
}): void {
  const { enabled, screenRef, streamer, getCanvas } = options;

  useEffect(() => {
    if (!enabled) return;
    const screen = screenRef.current;
    if (!screen) return;
    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const canvas = getCanvas();
      const scale = canvas && canvas.clientHeight > 0 ? canvas.height / canvas.clientHeight : 1;
      streamer.add(event.deltaY * scale, Date.now());
    };
    screen.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      screen.removeEventListener('wheel', handleWheel);
    };
  }, [enabled, screenRef, streamer, getCanvas]);
}
