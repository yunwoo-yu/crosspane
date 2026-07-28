import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'crosspane.panelHeight';
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 600;
const DEFAULT_HEIGHT = 250;

/** 하단 패널 높이 — 드래그 리사이즈 + localStorage 유지 */
export function usePanelHeight() {
  const [panelHeight, setPanelHeight] = useState(() => {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(saved) && saved >= MIN_HEIGHT && saved <= MAX_HEIGHT
      ? saved
      : DEFAULT_HEIGHT;
  });
  // 드래그 중 리스너 정리 함수 — pointerup이 창 밖에서 유실되거나 드래그 중
  // 언마운트돼도 전역 리스너가 남지 않게 ref로 보관한다
  const cleanupRef = useRef<(() => void) | null>(null);
  const heightRef = useRef(panelHeight);
  heightRef.current = panelHeight;
  useEffect(() => () => cleanupRef.current?.(), []);

  const startPanelResize = useCallback((event: React.PointerEvent) => {
    event.preventDefault();
    cleanupRef.current?.(); // 중복 드래그 방지
    const startY = event.clientY;
    const startHeight = heightRef.current;
    let latest = startHeight;
    const onMove = (move: PointerEvent) => {
      latest = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startHeight + (startY - move.clientY)));
      setPanelHeight(latest);
    };
    const onEnd = () => {
      cleanupRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      // 스토리지는 드래그 종료 시 1회만 — move마다 동기 쓰기는 낭비다
      localStorage.setItem(STORAGE_KEY, String(latest));
    };
    cleanupRef.current = onEnd;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  }, []);

  return { panelHeight, startPanelResize };
}
