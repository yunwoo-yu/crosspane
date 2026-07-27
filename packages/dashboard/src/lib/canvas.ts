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
