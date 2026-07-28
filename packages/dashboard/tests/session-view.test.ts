import { describe, expect, it } from 'vitest';
import { computeSessionView, computeUrlSync } from '../src/session-view';
import type { HelloEvent, LogEntry } from '../src/types';

const hello: HelloEvent = {
  type: 'hello',
  url: 'http://localhost:3000',
  device: 'iPhone 15',
  engines: ['chromium', 'webkit', 'ios-sim'],
  viewOnlyEngines: ['ios-sim'],
  viewport: { width: 390, height: 844 },
};

describe('computeSessionView', () => {
  it('중지된 엔진은 activeEngines에서 빠진다', () => {
    const view = computeSessionView(
      hello,
      {
        chromium: { status: 'ready' },
        webkit: { status: 'stopped' },
        'ios-sim': { status: 'ready' },
      },
      [],
    );
    expect(view.activeEngines).toEqual(['chromium', 'ios-sim']);
  });

  it('세션이 확정한 viewOnly가 hello의 초기 가정을 이긴다 (셸 성공 시 인터랙티브 전환)', () => {
    const view = computeSessionView(hello, { 'ios-sim': { status: 'ready', viewOnly: false } }, []);
    expect(view.isViewOnly('ios-sim')).toBe(false); // hello는 view-only라고 했지만 세션이 해제
    expect(view.isViewOnly('chromium')).toBe(false);
  });

  it('hello가 없으면 빈 뷰 + 기본 뷰포트', () => {
    const view = computeSessionView(null, {}, []);
    expect(view.engineNames).toEqual([]);
    expect(view.errorLogCount).toBe(0);
    expect(view.paneViewport).toEqual({ width: 390, height: 659 });
  });

  it('에러 배지는 엔진별 카운트의 합과 일치한다 (pane 배지와 동일 기준)', () => {
    const logs: LogEntry[] = [
      { id: 1, engine: 'chromium', kind: 'pageerror', level: 'error', text: 'a', ts: 1 },
      { id: 2, engine: 'webkit', kind: 'console', level: 'error', text: 'b', ts: 2 },
    ];
    const view = computeSessionView(
      hello,
      { chromium: { status: 'ready' }, webkit: { status: 'ready' } },
      logs,
    );
    expect(view.errorCounts.get('chromium')).toBe(1);
    expect(view.errorLogCount).toBe(2);
  });
});

describe('computeUrlSync', () => {
  it('view-only 엔진과 중지 엔진은 desync 판단에서 제외된다', () => {
    const states = {
      chromium: { status: 'ready' as const, currentUrl: 'http://a/1' },
      // ios-sim은 view-only — URL이 뒤처져도 desync가 아니다
      'ios-sim': { status: 'ready' as const, currentUrl: 'http://a/old' },
    };
    const result = computeUrlSync(states, ['chromium', 'ios-sim'], ['ios-sim']);
    expect(result.urlDesynced).toBe(false);
    expect(result.syncTargetUrl).toBe('http://a/1');
  });

  it('미러링 엔진끼리 URL이 다르면 desync', () => {
    const states = {
      chromium: { status: 'ready' as const, currentUrl: 'http://a/1' },
      webkit: { status: 'ready' as const, currentUrl: 'http://a/2' },
    };
    expect(computeUrlSync(states, ['chromium', 'webkit'], []).urlDesynced).toBe(true);
  });
});
