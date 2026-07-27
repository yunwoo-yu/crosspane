import { describe, expect, it } from 'vitest';
import { ANDROID_KEYCODES, parseScreenSize, toSwipeDistance } from '../src/android-emulator';

describe('parseScreenSize', () => {
  it('wm size 출력에서 해상도를 파싱한다', () => {
    expect(parseScreenSize('Physical size: 1080x2400\n')).toEqual({ width: 1080, height: 2400 });
  });

  it('파싱 불가면 던진다', () => {
    expect(() => parseScreenSize('garbage')).toThrow(/Cannot parse screen size/);
  });
});

describe('toSwipeDistance', () => {
  it('CSS px 델타를 기기 픽셀로 비례 환산한다 (기준 뷰포트 844px)', () => {
    // 844px 뷰포트 기준 422px 스크롤 = 화면 절반 → 2400px 화면에선 1200px
    expect(toSwipeDistance(422, 2400)).toBe(1200);
  });

  it('화면 높이의 60%를 넘지 않도록 제한한다', () => {
    expect(toSwipeDistance(10_000, 2400)).toBe(1440);
    expect(toSwipeDistance(-10_000, 2400)).toBe(-1440);
  });
});

describe('ANDROID_KEYCODES', () => {
  it('대시보드가 포워딩하는 특수키가 모두 매핑돼 있다', () => {
    for (const key of ['Enter', 'Backspace', 'Delete', 'Tab', 'Escape', 'ArrowDown']) {
      expect(ANDROID_KEYCODES[key]).toBeTypeOf('number');
    }
    expect(ANDROID_KEYCODES.Back).toBe(4); // 실제 Android 뒤로가기
  });
});
