/** 표시 px → 엔진(프레임) px 환산 계수 — 휠/드래그 델타의 단위 통일에 쓴다 */
export function displayToEngineScale(canvas: HTMLCanvasElement | null): number {
  if (!canvas || canvas.clientHeight === 0) return 1;
  return canvas.height / canvas.clientHeight;
}

/** 에코 오프셋(엔진 CSS px)을 표시 스케일로 환산해 canvas transform에 적용한다 */
export function applyEchoOffset(canvas: HTMLCanvasElement, offsetPx: number): void {
  if (canvas.height === 0 || offsetPx === 0) {
    canvas.style.transform = '';
    return;
  }
  const clamped = Math.max(-canvas.height, Math.min(canvas.height, offsetPx));
  const displayScale = canvas.clientHeight / canvas.height;
  canvas.style.transform = `translateY(${-clamped * displayScale}px)`;
}
