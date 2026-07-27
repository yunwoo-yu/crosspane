/**
 * 스크롤 로컬 에코(VNC식 예측) 상태 기계 — DOM/React 무관 순수 모듈.
 *
 * 휠 경로와 프레임 경로가 공유하는 상태(사용자 목표 위치 vs 프레임 실제 위치)를
 * 한 곳이 소유한다. 두 경로는 각자 "지금 canvas에 적용할 오프셋(px)"만 받아간다.
 *
 * 불변식 (frame-rendering 규칙):
 * - 프레임 도착이 에코를 무조건 리셋하면 고무줄 튐이 난다 — 남은 차이만 유지
 * - 휠이 멈춘 지 releaseAfterMs가 지나면 실제 프레임 위치로 스냅
 */

const RELEASE_AFTER_MS = 400;
// 이 이하 차이는 따라잡은 것으로 본다 (서브픽셀 진동 방지)
const CONVERGED_THRESHOLD_PX = 2;

export class ScrollEcho {
  private localTargetY: number | null = null;
  private lastFrameScrollY: number | null = null;
  private lastWheelTs = 0;

  /** 휠 입력 반영 — canvas에 즉시 적용할 오프셋(px)을 돌려준다 */
  addWheelDelta(deltaY: number, now: number): number {
    this.lastWheelTs = now;
    const base = this.localTargetY ?? this.lastFrameScrollY ?? 0;
    this.localTargetY = Math.max(0, base + deltaY);
    return this.localTargetY - (this.lastFrameScrollY ?? 0);
  }

  /**
   * 프레임 도착 반영 — 적용할 오프셋(px)을 돌려준다 (0 = 실제 화면으로 스냅).
   * scrollY < 0(위치 미상, 실기기 pane)이면 에코 없이 0.
   */
  reconcileFrame(frameScrollY: number, now: number): number {
    if (frameScrollY < 0) return 0;
    this.lastFrameScrollY = frameScrollY;
    const target = this.localTargetY;
    const wheelIdle = now - this.lastWheelTs > RELEASE_AFTER_MS;
    if (target === null || wheelIdle || Math.abs(target - frameScrollY) < CONVERGED_THRESHOLD_PX) {
      this.localTargetY = null;
      return 0;
    }
    return target - frameScrollY;
  }
}
