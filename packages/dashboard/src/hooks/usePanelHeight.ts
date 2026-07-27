import { useCallback, useState } from 'react';

const STORAGE_KEY = 'crosspane.panelHeight';
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 600;
const DEFAULT_HEIGHT = 250;

/** 하단 패널 높이 — 드래그 리사이즈 + localStorage 유지 */
export function usePanelHeight() {
  const [panelHeight, setPanelHeight] = useState(() => {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(saved) && saved >= MIN_HEIGHT ? saved : DEFAULT_HEIGHT;
  });

  const startPanelResize = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = panelHeight;
      const onMove = (move: PointerEvent) => {
        const next = Math.min(
          MAX_HEIGHT,
          Math.max(MIN_HEIGHT, startHeight + (startY - move.clientY)),
        );
        setPanelHeight(next);
        localStorage.setItem(STORAGE_KEY, String(next));
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [panelHeight],
  );

  return { panelHeight, startPanelResize };
}
