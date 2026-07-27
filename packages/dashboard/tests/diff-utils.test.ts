import { describe, expect, it } from 'vitest';
import { computePixelDiff, DEFAULT_DIFF_THRESHOLD, formatMismatchRatio } from '../src/diff-utils';

function solidImage(width: number, height: number, rgba: [number, number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(rgba, i * 4);
  return { width, height, data };
}

describe('computePixelDiff', () => {
  it('동일 이미지는 mismatch 0', () => {
    const a = solidImage(4, 4, [10, 20, 30, 255]);
    const result = computePixelDiff(a, solidImage(4, 4, [10, 20, 30, 255]));
    expect(result.mismatchRatio).toBe(0);
    expect(result.mismatchedPixels).toBe(0);
  });

  it('threshold 이하의 미세 차이(JPEG 노이즈)는 무시한다', () => {
    const a = solidImage(2, 2, [100, 100, 100, 255]);
    const b = solidImage(2, 2, [100 + DEFAULT_DIFF_THRESHOLD, 100, 100, 255]);
    expect(computePixelDiff(a, b).mismatchedPixels).toBe(0);
  });

  it('다른 픽셀을 강조색으로 표시하고 비율을 계산한다', () => {
    const a = solidImage(2, 2, [0, 0, 0, 255]);
    const b = solidImage(2, 2, [0, 0, 0, 255]);
    // 픽셀 하나만 완전히 다르게
    b.data.set([255, 255, 255, 255], 0);
    const result = computePixelDiff(a, b);
    expect(result.mismatchedPixels).toBe(1);
    expect(result.mismatchRatio).toBe(0.25);
    expect([result.diff[0], result.diff[1], result.diff[2]]).toEqual([255, 60, 60]);
    expect(result.diff[7]).toBe(70); // 일치 픽셀은 반투명 원본
  });

  it('크기가 다르면 명확한 에러', () => {
    expect(() =>
      computePixelDiff(solidImage(2, 2, [0, 0, 0, 255]), solidImage(3, 2, [0, 0, 0, 255])),
    ).toThrow(/equal sizes/);
  });
});

describe('formatMismatchRatio', () => {
  it('백분율 표기', () => {
    expect(formatMismatchRatio(0.0012)).toBe('0.12%');
    expect(formatMismatchRatio(0)).toBe('0.00%');
  });
});
