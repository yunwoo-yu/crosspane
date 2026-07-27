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
}): void {
  const { enabled, screenRef, streamer } = options;

  useEffect(() => {
    if (!enabled) return;
    const screen = screenRef.current;
    if (!screen) return;
    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault();
      streamer.add(event.deltaY, Date.now());
    };
    screen.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      screen.removeEventListener('wheel', handleWheel);
    };
  }, [enabled, screenRef, streamer]);
}
