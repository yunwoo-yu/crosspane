import { describe, expect, it } from 'vitest';
import {
  countErrorsSinceLastNavigation,
  detectUrlDesync,
  filterLogs,
  isNearBottom,
  normalizeUrlInput,
  toDisplayPath,
} from '../src/log-utils';
import type { LogEntry } from '../src/types';

function entry(partial: Partial<LogEntry> & Pick<LogEntry, 'engine' | 'kind'>): LogEntry {
  return { id: 0, level: 'log', text: '', ts: 0, ...partial };
}

describe('countErrorsSinceLastNavigation', () => {
  it('내비게이션 이후의 에러만 센다', () => {
    const logs: LogEntry[] = [
      entry({ engine: 'chromium', kind: 'pageerror', level: 'error' }), // 이전 페이지 에러
      entry({ engine: 'chromium', kind: 'navigation', level: 'info' }), // 페이지 이동
      entry({ engine: 'chromium', kind: 'httperror', level: 'error' }),
      entry({ engine: 'chromium', kind: 'console', level: 'log' }),
    ];
    expect(countErrorsSinceLastNavigation(logs, 'chromium')).toBe(1);
  });

  it('다른 엔진의 내비게이션은 카운터를 리셋하지 않는다', () => {
    const logs: LogEntry[] = [
      entry({ engine: 'chromium', kind: 'pageerror', level: 'error' }),
      entry({ engine: 'webkit', kind: 'navigation', level: 'info' }),
    ];
    expect(countErrorsSinceLastNavigation(logs, 'chromium')).toBe(1);
  });
});

describe('detectUrlDesync', () => {
  it('모든 엔진이 같은 URL이면 false', () => {
    expect(
      detectUrlDesync({
        chromium: { status: 'ready', currentUrl: 'http://a/?date=1' },
        webkit: { status: 'ready', currentUrl: 'http://a/?date=1' },
      }),
    ).toBe(false);
  });

  it('쿼리 파라미터만 달라도 어긋남으로 감지한다', () => {
    expect(
      detectUrlDesync({
        chromium: { status: 'ready', currentUrl: 'http://a/?date=2026-08-02' },
        webkit: { status: 'ready', currentUrl: 'http://a/?date=2026-08-03' },
      }),
    ).toBe(true);
  });

  it('URL이 하나뿐이면(아직 로딩 중) 판단하지 않는다', () => {
    expect(
      detectUrlDesync({
        chromium: { status: 'ready', currentUrl: 'http://a/' },
        webkit: { status: 'starting' },
      }),
    ).toBe(false);
  });
});

describe('toDisplayPath', () => {
  it('path와 query만 남긴다', () => {
    expect(toDisplayPath('http://localhost:3000/reservations/1?tab=info')).toBe(
      '/reservations/1?tab=info',
    );
  });

  it('파싱 불가능한 값은 그대로 돌려준다', () => {
    expect(toDisplayPath('about:blank')).toBe('about:blank');
  });
});

describe('normalizeUrlInput', () => {
  it(':3000 축약을 확장한다', () => {
    expect(normalizeUrlInput(':3000')).toBe('http://localhost:3000');
  });

  it('스킴이 없으면 http를 붙인다', () => {
    expect(normalizeUrlInput('example.com/path')).toBe('http://example.com/path');
  });

  it('완전한 URL은 그대로', () => {
    expect(normalizeUrlInput('https://a.dev')).toBe('https://a.dev');
  });
});

describe('filterLogs', () => {
  const logs: LogEntry[] = [
    entry({ engine: 'chromium', kind: 'console', level: 'log', text: 'hello world' }),
    entry({ engine: 'chromium', kind: 'console', level: 'warning', text: 'careful' }),
    entry({ engine: 'chromium', kind: 'pageerror', level: 'error', text: 'boom' }),
    entry({ engine: 'chromium', kind: 'navigation', level: 'info', text: 'http://a/' }),
  ];

  it('error 레벨은 에러만 (내비게이션 구분선은 항상 유지)', () => {
    const result = filterLogs(logs, 'error', '');
    expect(result.map((log) => log.kind)).toEqual(['pageerror', 'navigation']);
  });

  it('warning 레벨은 warning 이상', () => {
    expect(filterLogs(logs, 'warning', '').map((log) => log.text)).toEqual([
      'careful',
      'boom',
      'http://a/',
    ]);
  });

  it('검색은 텍스트 부분일치 (대소문자 무시)', () => {
    expect(filterLogs(logs, 'all', 'HELLO').map((log) => log.text)).toEqual([
      'hello world',
      'http://a/',
    ]);
  });
});

describe('isNearBottom', () => {
  it('바닥 근처면 true, 위로 스크롤했으면 false', () => {
    expect(isNearBottom({ scrollTop: 990, scrollHeight: 1200, clientHeight: 200 })).toBe(true);
    expect(isNearBottom({ scrollTop: 100, scrollHeight: 1200, clientHeight: 200 })).toBe(false);
  });
});
