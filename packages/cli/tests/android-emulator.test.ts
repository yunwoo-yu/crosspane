import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ANDROID_KEYCODES,
  adbExecutableName,
  androidSdkCandidateDirs,
  emulatorExecutableName,
  parseScreenSize,
  toSwipeDistance,
} from '../src/android-emulator';

describe('크로스 플랫폼 SDK 탐지', () => {
  it('Windows는 %LOCALAPPDATA%\\Android\\Sdk와 .exe 실행 파일을 쓴다', () => {
    const dirs = androidSdkCandidateDirs(
      { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' },
      'win32',
      'C:\\Users\\me',
    );
    expect(dirs).toContain(join('C:\\Users\\me\\AppData\\Local', 'Android', 'Sdk'));
    expect(adbExecutableName('win32')).toBe('adb.exe');
    expect(emulatorExecutableName('win32')).toBe('emulator.exe');
  });

  it('Linux는 ~/Android/Sdk를 후보에 넣는다', () => {
    const dirs = androidSdkCandidateDirs({}, 'linux', '/home/me');
    expect(dirs).toContain(join('/home/me', 'Android/Sdk'));
    expect(adbExecutableName('linux')).toBe('adb');
  });

  it('macOS는 표준 경로와 homebrew 경로를 후보에 넣는다', () => {
    const dirs = androidSdkCandidateDirs({}, 'darwin', '/Users/me');
    expect(dirs).toContain(join('/Users/me', 'Library/Android/sdk'));
    expect(dirs).toContain('/opt/homebrew/share/android-commandlinetools');
  });

  it('ANDROID_HOME 환경변수가 모든 OS에서 최우선이다', () => {
    const dirs = androidSdkCandidateDirs({ ANDROID_HOME: '/custom/sdk' }, 'linux', '/home/me');
    expect(dirs[0]).toBe('/custom/sdk');
  });
});

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
