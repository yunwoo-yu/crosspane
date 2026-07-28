import { describe, expect, it } from 'vitest';
import {
  logEntryFromEvent,
  networkEntryFromEvent,
  reduceSessionMetas,
  reduceSessionStates,
} from '../src/event-log';
import type { ServerEvent, SessionMeta } from '../src/types';

const session = (id: string): SessionMeta => ({
  id,
  label: `session ${id}`,
  userAgent: 'ua',
  startedAt: 0,
});

describe('reduceSessionStates', () => {
  it('hello는 세션 목록으로 상태를 재설정한다 (재접속 경계)', () => {
    const next = reduceSessionStates({ old: { live: true, errorCount: 5 } }, {
      type: 'hello',
      sessions: [session('a')],
    } as ServerEvent);
    expect(next).toEqual({ a: { live: true, errorCount: 0 } });
  });

  it('session-left는 히스토리를 지우지 않고 live만 내린다', () => {
    const next = reduceSessionStates(
      { a: { live: true, errorCount: 2, currentUrl: 'http://x/' } },
      { type: 'session-left', sessionId: 'a', ts: 1 },
    );
    expect(next.a).toMatchObject({ live: false, errorCount: 2, currentUrl: 'http://x/' });
  });

  it('navigation은 에러 카운트를 리셋한다 (이전 페이지 에러가 남지 않게)', () => {
    const next = reduceSessionStates(
      { a: { live: true, errorCount: 3 } },
      { type: 'navigation', sessionId: 'a', url: 'http://x/next', ts: 1 },
    );
    expect(next.a).toEqual({ live: true, currentUrl: 'http://x/next', errorCount: 0 });
  });

  it('pageerror는 에러 카운트를 올린다', () => {
    const next = reduceSessionStates(
      { a: { live: true, errorCount: 1 } },
      { type: 'pageerror', sessionId: 'a', message: 'boom', ts: 1 },
    );
    expect(next.a.errorCount).toBe(2);
  });
});

describe('reduceSessionMetas', () => {
  it('hello는 전체 교체, session-joined는 증분 추가', () => {
    const afterHello = reduceSessionMetas({}, { type: 'hello', sessions: [session('a')] });
    expect(Object.keys(afterHello)).toEqual(['a']);
    const afterJoin = reduceSessionMetas(afterHello, {
      type: 'session-joined',
      session: session('b'),
    });
    expect(Object.keys(afterJoin).sort()).toEqual(['a', 'b']);
  });
});

describe('logEntryFromEvent / networkEntryFromEvent', () => {
  it('console/pageerror/navigation을 로그 엔트리로, network는 null', () => {
    expect(
      logEntryFromEvent({ type: 'console', sessionId: 'a', level: 'log', text: 'hi', ts: 1 }),
    ).toMatchObject({ kind: 'console', text: 'hi' });
    expect(
      logEntryFromEvent({ type: 'pageerror', sessionId: 'a', message: 'x', stack: 's', ts: 1 }),
    ).toMatchObject({ kind: 'pageerror', level: 'error', detail: 's' });
    expect(
      logEntryFromEvent({ type: 'navigation', sessionId: 'a', url: 'u', ts: 1 }),
    ).toMatchObject({ kind: 'navigation' });
    expect(
      logEntryFromEvent({
        type: 'network',
        sessionId: 'a',
        method: 'GET',
        url: 'u',
        status: 200,
        durationMs: 5,
        ts: 1,
      }),
    ).toBeNull();
  });

  it('network 이벤트만 네트워크 엔트리가 된다', () => {
    expect(
      networkEntryFromEvent({
        type: 'network',
        sessionId: 'a',
        method: 'POST',
        url: 'u',
        status: 0,
        durationMs: 3,
        error: 'failed',
        ts: 1,
      }),
    ).toMatchObject({ method: 'POST', status: 0, error: 'failed' });
    expect(
      networkEntryFromEvent({ type: 'console', sessionId: 'a', level: 'log', text: 't', ts: 1 }),
    ).toBeNull();
  });
});
