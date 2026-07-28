import { applyEchoOffset } from './lib/canvas';
import { ScrollEcho } from './scroll-echo';
import type { PaneFrame } from './types';

/** VideoFrame은 width 대신 displayWidth를 쓴다 */
function frameSize(frame: PaneFrame): { width: number; height: number } {
  if ('displayWidth' in frame) return { width: frame.displayWidth, height: frame.displayHeight };
  return { width: frame.width, height: frame.height };
}

/** 소스 종류에 맞는 캔버스 드로우 — ImageData는 putImageData(복사 제로) */
function drawFrame(canvas: HTMLCanvasElement, frame: PaneFrame): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  if (frame instanceof ImageData) ctx.putImageData(frame, 0, 0);
  else ctx.drawImage(frame, 0, 0);
}

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
  /** window 모드 마지막 프레임 사본 — 에코를 canvas 내부 드로우로 재합성하기 위해 보관 */
  private echoBacking: HTMLCanvasElement | null = null;
  private displayScrollY = 0;
  private lastInputTs = 0;
  private readonly echo = new ScrollEcho();

  constructor(
    private readonly viewportCss: { width: number; height: number },
    /**
     * 에코 방식:
     * - absolute: scrollY 정합 가능한 엔진 — 목표-실제 차이만큼 transform (기존)
     * - relative: scrollY 미상 + 스트림 지연(Android 비디오) — 델타를 시간 감쇠로
     *   선행 표시해 스트림 지연(~0.5s)을 체감에서 지운다
     */
    private echoMode: 'absolute' | 'relative' = 'absolute',
  ) {}

  // relative 에코 상태 — 각 델타는 ECHO_DECAY_MS에 걸쳐 0으로 감쇠 (스트림이 따라오는 시간)
  private static readonly RELATIVE_DECAY_MS = 300;
  /** 상대 에코 최대 오프셋 (캔버스 높이 비율) — 가장자리 스트레치가 과해지지 않는 선 */
  private static readonly RELATIVE_MAX_RATIO = 0.22;
  private relativeDeltas: { delta: number; ts: number }[] = [];
  private decayRafScheduled = false;
  private lastCanvas: HTMLCanvasElement | null = null;

  private applyRelativeEcho(now: number): void {
    this.relativeDeltas = this.relativeDeltas.filter(
      (entry) => now - entry.ts < PaneScreen.RELATIVE_DECAY_MS,
    );
    const offset = this.relativeDeltas.reduce(
      (sum, entry) => sum + entry.delta * (1 - (now - entry.ts) / PaneScreen.RELATIVE_DECAY_MS),
      0,
    );
    if (this.lastCanvas) {
      const cap = this.lastCanvas.height * PaneScreen.RELATIVE_MAX_RATIO;
      this.drawEchoOffset(this.lastCanvas, Math.max(-cap, Math.min(cap, offset)));
    }
    if (this.relativeDeltas.length > 0 && !this.decayRafScheduled) {
      this.decayRafScheduled = true;
      requestAnimationFrame(() => {
        this.decayRafScheduled = false;
        this.applyRelativeEcho(Date.now());
      });
    }
  }

  /**
   * 에코 오프셋을 canvas 내부 드로우로 반영 — transform 이동과 달리 빈(검은) 영역이
   * 생기지 않는다. 밀려나는 반대쪽 가장자리는 밴드(오프셋의 2배 높이)를 늘려 채워
   * 네이티브 오버스크롤 스트레치처럼 보인다. 마지막 1px 행 스트레치는 금물 —
   * Android 제스처 바(검정 pill)가 그대로 번진다 (실측).
   * 2D 컨텍스트가 없는 환경(jsdom 테스트)은 기존 transform 방식으로 폴백한다.
   */
  private drawEchoOffset(canvas: HTMLCanvasElement, offsetPx: number): void {
    const src = this.echoBacking;
    const ctx = canvas.getContext('2d');
    if (!src || !ctx || !src.getContext('2d')) {
      applyEchoOffset(canvas, offsetPx);
      return;
    }
    canvas.style.transform = '';
    const { width: w, height: h } = canvas;
    const off = Math.round(Math.max(-h / 3, Math.min(h / 3, offsetPx)));
    if (off === 0) {
      ctx.drawImage(src, 0, 0);
      return;
    }
    const mag = Math.abs(off);
    const band = Math.min(mag * 2, h - mag - 1);
    if (off > 0) {
      // 위로 이동: 본문은 그대로 off만큼 시프트, 하단 밴드만 늘려 갭을 흡수
      ctx.drawImage(src, 0, off, w, h - band - off, 0, 0, w, h - band - off);
      ctx.drawImage(src, 0, h - band, w, band, 0, h - band - off, w, band + off);
    } else {
      // 아래로 이동: 상단 밴드를 늘리고 본문을 |off|만큼 내린다
      ctx.drawImage(src, 0, 0, w, band, 0, 0, w, band + mag);
      ctx.drawImage(src, 0, band, w, h - band - mag, 0, band + mag, w, h - band - mag);
    }
  }

  /** 유휴 판정 — 입력이 멈춘 뒤에는 엔진의 실제 스크롤 위치로 수렴한다 */
  private static readonly INPUT_IDLE_MS = 400;

  acceptFrame(
    canvas: HTMLCanvasElement,
    frame: PaneFrame,
    scrollY: number,
    fullPage: boolean,
    now: number,
  ): void {
    const { width: frameW, height: frameH } = frameSize(frame);
    if (!fullPage) {
      // window 모드 (page 모드였다면 백킹 폐기 — 뷰포트 폴백/엔진 전환)
      this.backing = null;
      if (canvas.width !== frameW || canvas.height !== frameH) {
        canvas.width = frameW;
        canvas.height = frameH;
      }
      // 프레임을 에코 백킹에 보관 — 에코 드로우가 오프셋 위치에 언제든 재합성한다
      if (
        !this.echoBacking ||
        this.echoBacking.width !== frameW ||
        this.echoBacking.height !== frameH
      ) {
        this.echoBacking ??= document.createElement('canvas');
        this.echoBacking.width = frameW;
        this.echoBacking.height = frameH;
      }
      const backingCtx = this.echoBacking.getContext('2d');
      if (backingCtx) {
        if (frame instanceof ImageData) backingCtx.putImageData(frame, 0, 0);
        else backingCtx.drawImage(frame, 0, 0);
      }
      drawFrame(canvas, frame);
      this.lastCanvas = canvas;
      // scrollY 미상 스트림(idb 등)으로 전환된 pane은 절대 에코가 불가능 — 상대 에코로 강등
      if (scrollY < 0 && this.echoMode === 'absolute') this.echoMode = 'relative';
      if (this.echoMode === 'relative') {
        // 프레임 도착이 에코를 리셋하지 않는다 — 스트림은 항상 과거라 리셋하면 뒤로 튄다
        this.applyRelativeEcho(now);
      } else {
        this.drawEchoOffset(canvas, this.echo.reconcileFrame(scrollY, now));
      }
      return;
    }

    // page 모드: 풀페이지 비트맵을 백킹에 보관
    if (!this.backing || this.backing.width !== frameW || this.backing.height !== frameH) {
      this.backing ??= document.createElement('canvas');
      this.backing.width = frameW;
      this.backing.height = frameH;
    }
    if (frame instanceof ImageData) this.backing.getContext('2d')?.putImageData(frame, 0, 0);
    else this.backing.getContext('2d')?.drawImage(frame, 0, 0);

    const viewportPx = this.viewportHeightPx(frameW);
    if (canvas.width !== frameW || canvas.height !== viewportPx) {
      canvas.width = frameW;
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
    this.lastCanvas = canvas;
    if (this.echoMode === 'relative') {
      this.relativeDeltas.push({ delta: deltaY, ts: now });
      this.applyRelativeEcho(now);
      return;
    }
    this.drawEchoOffset(canvas, this.echo.addWheelDelta(deltaY, now));
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
