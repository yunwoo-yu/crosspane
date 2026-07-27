import { describe, expect, it } from 'vitest';
import { ScrollEcho } from '../src/scroll-echo';

describe('ScrollEcho', () => {
  it('휠 입력은 즉시 오프셋을 만들고, 프레임이 따라오면 남은 차이만 유지한다', () => {
    const echo = new ScrollEcho();
    echo.reconcileFrame(0, 0); // 기준 프레임
    expect(echo.addWheelDelta(70, 100)).toBe(70);
    // 목표(70)에 못 미친 프레임(30) — 고무줄 방지: 남은 40만 유지
    expect(echo.reconcileFrame(30, 150)).toBe(40);
    // 목표를 따라잡은 프레임 — 스냅
    expect(echo.reconcileFrame(70, 200)).toBe(0);
  });

  it('휠이 멈춘 뒤 오래된 프레임은 에코를 해제한다 (스냅)', () => {
    const echo = new ScrollEcho();
    echo.addWheelDelta(100, 0);
    expect(echo.reconcileFrame(10, 1_000)).toBe(0); // 400ms 초과 → 해제
  });

  it('스크롤 위치를 모르는 프레임(scrollY<0)에는 에코를 적용하지 않는다', () => {
    const echo = new ScrollEcho();
    echo.addWheelDelta(100, 0);
    expect(echo.reconcileFrame(-1, 50)).toBe(0);
  });

  it('음수 스크롤 목표는 0으로 클램프한다', () => {
    const echo = new ScrollEcho();
    echo.reconcileFrame(0, 0);
    expect(echo.addWheelDelta(-500, 10)).toBe(0);
  });
});
