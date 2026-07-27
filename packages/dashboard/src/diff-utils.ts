/**
 * 엔진 간 스크린샷 픽셀 비교 — "iOS만 렌더링이 다르다"를 눈이 아니라 툴이 찾아낸다.
 * 외부 의존성 없이 RGB 거리 기반으로 충분하다 (안티앨리어싱 노이즈는 threshold로 흡수).
 */

export interface DiffableImage {
  width: number;
  height: number;
  /** RGBA, width * height * 4 */
  data: Uint8ClampedArray;
}

export interface PixelDiffResult {
  /** 0~1 — 서로 다른 픽셀 비율 */
  mismatchRatio: number;
  mismatchedPixels: number;
  totalPixels: number;
  /** 시각화용 RGBA — 동일 픽셀은 원본을 흐리게, 다른 픽셀은 강조색.
      ImageData 생성자가 SharedArrayBuffer 백킹을 거부하므로 ArrayBuffer로 고정 */
  diff: Uint8ClampedArray<ArrayBuffer>;
}

// JPEG 아티팩트/안티앨리어싱으로 인한 미세 차이는 무시한다 (채널당 0~255)
export const DEFAULT_DIFF_THRESHOLD = 24;

const HIGHLIGHT = { r: 255, g: 60, b: 60 } as const;

/** 두 이미지가 같은 크기라는 전제 하에 픽셀 단위 비교 (크기 정규화는 호출부 책임) */
export function computePixelDiff(
  a: DiffableImage,
  b: DiffableImage,
  threshold: number = DEFAULT_DIFF_THRESHOLD,
): PixelDiffResult {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`diff requires equal sizes (${a.width}x${a.height} vs ${b.width}x${b.height})`);
  }
  const totalPixels = a.width * a.height;
  const diff = new Uint8ClampedArray(totalPixels * 4);
  let mismatchedPixels = 0;

  for (let i = 0; i < totalPixels; i++) {
    const offset = i * 4;
    const deltaR = Math.abs(a.data[offset] - b.data[offset]);
    const deltaG = Math.abs(a.data[offset + 1] - b.data[offset + 1]);
    const deltaB = Math.abs(a.data[offset + 2] - b.data[offset + 2]);
    if (Math.max(deltaR, deltaG, deltaB) > threshold) {
      mismatchedPixels += 1;
      diff[offset] = HIGHLIGHT.r;
      diff[offset + 1] = HIGHLIGHT.g;
      diff[offset + 2] = HIGHLIGHT.b;
      diff[offset + 3] = 255;
    } else {
      // 일치 픽셀은 A를 흐리게 깔아 위치 파악을 돕는다
      diff[offset] = a.data[offset];
      diff[offset + 1] = a.data[offset + 1];
      diff[offset + 2] = a.data[offset + 2];
      diff[offset + 3] = 70;
    }
  }

  return {
    mismatchRatio: totalPixels === 0 ? 0 : mismatchedPixels / totalPixels,
    mismatchedPixels,
    totalPixels,
    diff,
  };
}

/** 비율을 사람이 읽는 표기로 (0.0012 → "0.12%") */
export function formatMismatchRatio(ratio: number): string {
  return `${(ratio * 100).toFixed(2)}%`;
}
