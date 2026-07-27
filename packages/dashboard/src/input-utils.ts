import type { ClientCommand } from './types';

/**
 * 포인터 제스처 분류 — 표시 px 이동 거리가 이 이하면 클릭, 넘으면 드래그.
 * 트랙패드/마우스의 미세 떨림이 드래그로 오인되지 않는 선에서 최소값.
 */
export const DRAG_THRESHOLD_PX = 6;

const DRAG_MIN_DURATION_MS = 40;
const DRAG_MAX_DURATION_MS = 1_000;

export interface PointerSample {
  /** 표시 좌표(px) — 클릭/드래그 판별용 */
  px: number;
  py: number;
  /** 정규화 좌표(0~1) — 엔진으로 보낼 값 */
  nx: number;
  ny: number;
  ts: number;
}

/**
 * pointerdown~pointerup 한 쌍을 click 또는 drag 커맨드로 변환한다.
 * 클릭 좌표는 눌렀던 지점(start) 기준 — 미세 이동으로 좌표가 흔들리지 않게.
 */
export function resolvePointerGesture(start: PointerSample, end: PointerSample): ClientCommand {
  const distance = Math.hypot(end.px - start.px, end.py - start.py);
  if (distance < DRAG_THRESHOLD_PX) {
    return { type: 'click', x: start.nx, y: start.ny };
  }
  return {
    type: 'drag',
    fromX: start.nx,
    fromY: start.ny,
    toX: end.nx,
    toY: end.ny,
    durationMs: Math.max(DRAG_MIN_DURATION_MS, Math.min(DRAG_MAX_DURATION_MS, end.ts - start.ts)),
  };
}
