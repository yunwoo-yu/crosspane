import { applyEchoOffset } from './lib/canvas';
import { ScrollEcho } from './scroll-echo';

/**
 * pane 화면 렌더러 — 프레임 종류에 따라 두 모드를 오간다.
 *
 * - **page 모드** (WebKit/Firefox 풀페이지 프레임): 페이지 전체 비트맵을 백킹 캔버스에
 *   보관하고, 표시는 현재 스크롤 위치의 크롭. 스크롤 = 순수 로컬 크롭 이동이라
 *   캡처 주기와 무관하게 입력 레이트(60fps+)로 움직이고 빈 영역이 없다
 * - **window 모드** (Chromium 스크린캐스트, 실기기): 뷰포트 프레임 + 스크롤 로컬 에코
 *
 * 단위: 브라우저 엔진 프레임은 scale:'css'라 프레임 px == CSS px — 스크롤 델타와 동일 단위.
 */
export class PaneScreen {
  private backing: HTMLCanvasElement | null = null;
  private displayScrollY = 0;
  private lastInputTs = 0;
  private readonly echo = new ScrollEcho();

  constructor(private readonly viewportCss: { width: number; height: number }) {}

  /** 유휴 판정 — 입력이 멈춘 뒤에는 엔진의 실제 스크롤 위치로 수렴한다 */
  private static readonly INPUT_IDLE_MS = 400;

  acceptFrame(
    canvas: HTMLCanvasElement,
    frame: ImageBitmap,
    scrollY: number,
    fullPage: boolean,
    now: number,
  ): void {
    if (!fullPage) {
      // window 모드 (page 모드였다면 백킹 폐기 — 뷰포트 폴백/엔진 전환)
      this.backing = null;
      if (canvas.width !== frame.width || canvas.height !== frame.height) {
        canvas.width = frame.width;
        canvas.height = frame.height;
      }
      canvas.getContext('2d')?.drawImage(frame, 0, 0);
      applyEchoOffset(canvas, this.echo.reconcileFrame(scrollY, now));
      return;
    }

    // page 모드: 풀페이지 비트맵을 백킹에 보관
    if (
      !this.backing ||
      this.backing.width !== frame.width ||
      this.backing.height !== frame.height
    ) {
      this.backing ??= document.createElement('canvas');
      this.backing.width = frame.width;
      this.backing.height = frame.height;
    }
    this.backing.getContext('2d')?.drawImage(frame, 0, 0);

    const viewportPx = this.viewportHeightPx(frame.width);
    if (canvas.width !== frame.width || canvas.height !== viewportPx) {
      canvas.width = frame.width;
      canvas.height = viewportPx;
    }
    canvas.style.transform = ''; // page 모드는 에코 transform을 쓰지 않는다
    // 입력이 멈춘 상태면 엔진의 실제 위치로 수렴 (클릭 좌표 정합)
    if (scrollY >= 0 && now - this.lastInputTs > PaneScreen.INPUT_IDLE_MS) {
      this.displayScrollY = scrollY;
    }
    this.redrawCrop(canvas);
  }

  /** 스크롤 델타 반영 — page 모드는 크롭 이동(60fps), window 모드는 로컬 에코 */
  scrollBy(canvas: HTMLCanvasElement, deltaY: number, now: number): void {
    this.lastInputTs = now;
    if (this.backing) {
      this.displayScrollY += deltaY;
      this.redrawCrop(canvas);
      return;
    }
    applyEchoOffset(canvas, this.echo.addWheelDelta(deltaY, now));
  }

  private redrawCrop(canvas: HTMLCanvasElement): void {
    const backing = this.backing;
    if (!backing) return;
    const viewportPx = canvas.height;
    const maxScroll = Math.max(0, backing.height - viewportPx);
    this.displayScrollY = Math.max(0, Math.min(maxScroll, this.displayScrollY));
    canvas
      .getContext('2d')
      ?.drawImage(
        backing,
        0,
        this.displayScrollY,
        backing.width,
        viewportPx,
        0,
        0,
        backing.width,
        viewportPx,
      );
  }

  private viewportHeightPx(frameWidth: number): number {
    return Math.round((this.viewportCss.height * frameWidth) / this.viewportCss.width);
  }
}
