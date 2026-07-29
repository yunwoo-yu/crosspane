import { describe, expect, it } from 'vitest';
import {
  type ConsoleLevelFilter,
  filterLogs,
  formatLogTime,
  isNearBottom,
  toDisplayPath,
} from '../src/log-utils';
import type { LogEntry } from '../src/types';

const log = (partial: Partial<LogEntry>): LogEntry => ({
  id: 0,
  sessionId: 'a',
  kind: 'console',
  level: 'log',
  text: '',
  ts: 0,
  ...partial,
});

describe('filterLogs', () => {
  const logs = [
    log({ id: 1, level: 'log', text: 'hello' }),
    log({ id: 2, level: 'warning', text: 'careful' }),
    log({ id: 3, level: 'error', text: 'boom' }),
    log({ id: 4, kind: 'navigation', level: 'info', text: 'http://x/' }),
  ];
  /** 세션·검색 기본값 — 각 테스트가 관심 있는 축만 덮어쓴다 */
  const ids = (level: ConsoleLevelFilter, search = '', sessionId: string | 'all' = 'all') =>
    filterLogs(logs, { level, search, sessionId }).map((entry) => entry.id);

  it('레벨 필터는 누적 의미다 (warning은 error 포함)', () => {
    expect(ids('error')).toEqual([3, 4]);
    expect(ids('warning')).toEqual([2, 3, 4]);
    expect(ids('log')).toEqual([1, 4]);
  });

  it('내비게이션 구분선은 레벨·검색과 무관하게 남는다 (맥락 유지)', () => {
    expect(ids('error', 'nomatch')).toEqual([4]);
  });

  it('검색은 대소문자를 무시한다', () => {
    expect(ids('all', 'BOOM')).toEqual([3, 4]);
  });

  it('세션 필터는 내비게이션 구분선도 걸러낸다 — 다른 세션의 것이 섞이면 안 된다', () => {
    const mixed = [...logs, log({ id: 5, sessionId: 'b', text: 'other session' })];
    expect(
      filterLogs(mixed, { level: 'all', search: '', sessionId: 'b' }).map((e) => e.id),
    ).toEqual([5]);
    expect(
      filterLogs(mixed, { level: 'all', search: '', sessionId: 'a' }).map((e) => e.id),
    ).toEqual([1, 2, 3, 4]);
  });

  it('세 축이 함께 적용된다', () => {
    const mixed = [
      log({ id: 1, sessionId: 'a', level: 'error', text: 'boom in a' }),
      log({ id: 2, sessionId: 'b', level: 'error', text: 'boom in b' }),
      log({ id: 3, sessionId: 'a', level: 'log', text: 'boom quiet' }),
    ];
    expect(
      filterLogs(mixed, { level: 'error', search: 'boom', sessionId: 'a' }).map((e) => e.id),
    ).toEqual([1]);
  });
});

describe('toDisplayPath', () => {
  it('path+query만 남기고, http가 아니면 원본 유지', () => {
    expect(toDisplayPath('http://localhost:3000/a/b?c=1')).toBe('/a/b?c=1');
    expect(toDisplayPath('http://localhost:3000')).toBe('/');
    expect(toDisplayPath('about:blank')).toBe('about:blank');
    expect(toDisplayPath('not a url')).toBe('not a url');
  });
});

describe('formatLogTime / isNearBottom', () => {
  it('HH:MM:SS로 zero-pad한다', () => {
    expect(formatLogTime(new Date(2026, 0, 1, 9, 5, 3).getTime())).toBe('09:05:03');
  });

  it('바닥 근처 판정 (오토스크롤 유지 조건)', () => {
    expect(isNearBottom({ scrollTop: 900, scrollHeight: 1000, clientHeight: 100 })).toBe(true);
    expect(isNearBottom({ scrollTop: 100, scrollHeight: 1000, clientHeight: 100 })).toBe(false);
  });
});
