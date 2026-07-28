import { describe, expect, it } from 'vitest';
import { parseShellEvent } from '../src/shell-events.js';

describe('parseShellEvent (iOS/Android 셸 이벤트 단일 파서)', () => {
  it('console 이벤트의 warn 레벨을 프로토콜 LogLevel(warning)로 정규화한다', () => {
    expect(parseShellEvent({ kind: 'console', level: 'warn', text: 'x' })).toEqual({
      kind: 'console',
      level: 'warning',
      text: 'x',
    });
    expect(parseShellEvent({ kind: 'console', level: 'error', text: 'y' })).toEqual({
      kind: 'console',
      level: 'error',
      text: 'y',
    });
  });

  it('레벨/텍스트 누락은 기본값으로 채운다', () => {
    expect(parseShellEvent({ kind: 'console' })).toEqual({
      kind: 'console',
      level: 'log',
      text: '',
    });
    expect(parseShellEvent({ kind: 'pageerror' })).toEqual({
      kind: 'pageerror',
      text: 'unknown error',
    });
  });

  it('navigation은 url이 있어야 유효하다', () => {
    expect(parseShellEvent({ kind: 'navigation', url: 'http://a/' })).toEqual({
      kind: 'navigation',
      url: 'http://a/',
    });
    expect(parseShellEvent({ kind: 'navigation' })).toBeNull();
  });

  it('잘못된/모르는 페이로드는 null (셸 버전 차이가 크래시가 되면 안 된다)', () => {
    expect(parseShellEvent(null)).toBeNull();
    expect(parseShellEvent('str')).toBeNull();
    expect(parseShellEvent({ kind: 'future-event' })).toBeNull();
  });
});
