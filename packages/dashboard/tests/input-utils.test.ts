import { describe, expect, it } from 'vitest';
import { DRAG_THRESHOLD_PX, resolvePointerGesture } from '../src/input-utils';

const sample = (px: number, py: number, nx: number, ny: number, ts: number) => ({
  px,
  py,
  nx,
  ny,
  ts,
});

describe('resolvePointerGesture', () => {
  it('임계 미만 이동은 클릭 — 좌표는 누른 지점 기준', () => {
    const command = resolvePointerGesture(
      sample(50, 50, 0.5, 0.25, 0),
      sample(52, 51, 0.52, 0.26, 120),
    );
    expect(command).toEqual({ type: 'click', x: 0.5, y: 0.25 });
  });

  it('임계 이상 이동은 드래그 — 실제 소요 시간을 담는다', () => {
    const command = resolvePointerGesture(
      sample(50, 160, 0.5, 0.8, 1000),
      sample(50, 40, 0.5, 0.2, 1300),
    );
    expect(command).toEqual({
      type: 'drag',
      fromX: 0.5,
      fromY: 0.8,
      toX: 0.5,
      toY: 0.2,
      durationMs: 300,
    });
  });

  it('드래그 시간은 40~1000ms로 클램프한다 (엔진 재생 가능 범위)', () => {
    const instant = resolvePointerGesture(sample(0, 0, 0, 0, 0), sample(100, 0, 1, 0, 5));
    const slow = resolvePointerGesture(sample(0, 0, 0, 0, 0), sample(100, 0, 1, 0, 9999));
    expect(instant).toMatchObject({ durationMs: 40 });
    expect(slow).toMatchObject({ durationMs: 1000 });
  });

  it('임계값 자체는 드래그로 판정한다', () => {
    const command = resolvePointerGesture(
      sample(0, 0, 0, 0, 0),
      sample(DRAG_THRESHOLD_PX, 0, 0.1, 0, 100),
    );
    expect(command.type).toBe('drag');
  });
});
