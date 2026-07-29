import { describe, expect, it } from 'vitest';
import { filterLogs, formatLogTime, isNearBottom, toDisplayPath } from '../src/log-utils';
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

  it('레벨 필터는 누적 의미다 (warning은 error 포함)', () => {
    expect(filterLogs(logs, 'error', '').map((l) => l.id)).toEqual([3, 4]);
    expect(filterLogs(logs, 'warning', '').map((l) => l.id)).toEqual([2, 3, 4]);
    expect(filterLogs(logs, 'log', '').map((l) => l.id)).toEqual([1, 4]);
  });

  it('내비게이션 구분선은 필터와 무관하게 남는다 (맥락 유지)', () => {
    expect(filterLogs(logs, 'error', 'nomatch').map((l) => l.id)).toEqual([4]);
  });

  it('검색은 대소문자를 무시한다', () => {
    expect(filterLogs(logs, 'all', 'BOOM').map((l) => l.id)).toEqual([3, 4]);
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
