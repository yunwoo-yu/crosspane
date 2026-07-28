import { describe, expect, it } from 'vitest';
import { latestVersionName } from '../src/android-shell.js';

describe('latestVersionName', () => {
  it('숫자 기준으로 최신 버전을 고른다 (사전순이면 9 > 35로 잘못 뽑힌다)', () => {
    expect(latestVersionName(['android-9', 'android-35', 'android-34'])).toBe('android-35');
    expect(latestVersionName(['9.0.0', '35.0.0', '34.0.0'])).toBe('35.0.0');
  });

  it('숨김 항목(.DS_Store 등)은 제외한다', () => {
    expect(latestVersionName(['.DS_Store', '34.0.0'])).toBe('34.0.0');
  });

  it('후보가 없으면 undefined', () => {
    expect(latestVersionName([])).toBeUndefined();
    expect(latestVersionName(['.hidden'])).toBeUndefined();
  });
});
