import { describe, expect, it } from 'vitest';
import { resolveDevice } from '../src/devices';

describe('resolveDevice', () => {
  it('Playwright 프리셋 이름으로 뷰포트를 얻는다', () => {
    const viewport = resolveDevice('iPhone 15');
    expect(viewport.width).toBeGreaterThan(0);
    expect(viewport.height).toBeGreaterThan(viewport.width); // 모바일 세로 화면
  });

  it('알 수 없는 기기면 예시 목록과 함께 던진다', () => {
    expect(() => resolveDevice('Nokia 3310')).toThrow(
      /Unknown device "Nokia 3310"\. Examples: .*(iPhone|Galaxy|Pixel|iPad)/s,
    );
  });
});
