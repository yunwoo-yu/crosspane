import { describe, expect, it } from 'vitest';
import { logEntryFromEvent, reduceEngineStates } from '../src/event-log';
import type { ServerEvent } from '../src/types';

describe('reduceEngineStates (이벤트→상태 전이 규칙)', () => {
  it('hello는 엔진 목록을 starting으로 초기화한다', () => {
    const next = reduceEngineStates(
      { chromium: { status: 'ready' } },
      {
        type: 'hello',
        url: 'http://a/',
        device: 'iPhone 15',
        engines: ['webkit'],
        viewport: { width: 390, height: 844 },
      },
    );
    expect(next).toEqual({ webkit: { status: 'starting' } });
  });

  it('engine-status의 viewOnly 미지정은 기존 값을 보존한다 (셸 모드 유지)', () => {
    const next = reduceEngineStates(
      { 'ios-sim': { status: 'ready', viewOnly: false, detail: 'WKWebView' } },
      { type: 'engine-status', engine: 'ios-sim', status: 'ready' },
    );
    expect(next['ios-sim']?.viewOnly).toBe(false);
  });

  it('navigation은 기존 필드(viewOnly/detail)를 스프레드로 보존한다 — 실측 버그 방어', () => {
    const next = reduceEngineStates(
      { 'ios-sim': { status: 'ready', viewOnly: false, detail: 'WKWebView' } },
      { type: 'navigation', engine: 'ios-sim', url: 'http://a/b', ts: 1 },
    );
    expect(next['ios-sim']).toMatchObject({
      status: 'ready',
      viewOnly: false,
      detail: 'WKWebView',
      currentUrl: 'http://a/b',
    });
  });

  it('상태와 무관한 이벤트는 이전 참조를 그대로 반환한다 (불필요 리렌더 방지)', () => {
    const prev = { chromium: { status: 'ready' as const } };
    const event: ServerEvent = {
      type: 'console',
      engine: 'chromium',
      level: 'log',
      text: 'x',
      ts: 1,
    };
    expect(reduceEngineStates(prev, event)).toBe(prev);
  });
});

describe('logEntryFromEvent (이벤트→로그 매핑)', () => {
  it('pageerror/requestfailed/httperror는 error 레벨로 정규화된다', () => {
    expect(
      logEntryFromEvent({ type: 'pageerror', engine: 'webkit', message: 'boom', ts: 1 }),
    ).toMatchObject({ kind: 'pageerror', level: 'error', text: 'boom' });
    expect(
      logEntryFromEvent({ type: 'httperror', engine: 'chromium', url: '/api', status: 500, ts: 2 }),
    ).toMatchObject({ kind: 'httperror', level: 'error', text: 'HTTP 500 — /api' });
    expect(
      logEntryFromEvent({
        type: 'requestfailed',
        engine: 'firefox',
        url: '/x',
        error: 'timeout',
        ts: 3,
      }),
    ).toMatchObject({ kind: 'requestfailed', level: 'error' });
  });

  it('navigation은 info 구분선, hello/engine-status는 로그가 아니다', () => {
    expect(
      logEntryFromEvent({ type: 'navigation', engine: 'chromium', url: 'http://a/', ts: 1 }),
    ).toMatchObject({ kind: 'navigation', level: 'info' });
    expect(
      logEntryFromEvent({ type: 'engine-status', engine: 'chromium', status: 'ready' }),
    ).toBeNull();
  });
});
