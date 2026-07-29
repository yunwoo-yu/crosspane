import { describe, expect, it } from 'vitest';
import {
  logEntryFromEvent,
  mergeRepeatedLog,
  networkEntryFromEvent,
  reduceSessionMetas,
  reduceSessionStates,
} from '../src/event-log';
import type { LogEntry, ServerEvent, SessionMeta } from '../src/types';

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

describe('mergeRepeatedLog', () => {
  const entry = (partial: Partial<LogEntry>): LogEntry => ({
    id: 1,
    sessionId: 'a',
    kind: 'console',
    level: 'error',
    text: 'Failed to fetch',
    ts: 100,
    ...partial,
  });

  it('같은 내용의 연속 로그를 합치고 횟수를 센다', () => {
    const merged = mergeRepeatedLog(entry({}), entry({ ts: 200 }));
    expect(merged).toMatchObject({ repeat: 2, ts: 100 }); // ts는 첫 발생 유지
  });

  it('이미 합쳐진 것끼리도 더한다 (배치 경계에서 갈린 런)', () => {
    const merged = mergeRepeatedLog(entry({ repeat: 300 }), entry({ repeat: 250 }));
    expect(merged?.repeat).toBe(550);
  });

  it('내용·레벨·세션이 다르면 합치지 않는다', () => {
    expect(mergeRepeatedLog(entry({}), entry({ text: 'other' }))).toBeNull();
    expect(mergeRepeatedLog(entry({}), entry({ level: 'log' }))).toBeNull();
    expect(mergeRepeatedLog(entry({}), entry({ sessionId: 'b' }))).toBeNull();
  });

  it('스택이 다르면 합치지 않는다 — 같은 메시지의 다른 경로다', () => {
    expect(
      mergeRepeatedLog(entry({ kind: 'pageerror', detail: 'at a.js' }), {
        ...entry({ kind: 'pageerror', detail: 'at b.js' }),
      }),
    ).toBeNull();
  });

  it('내비게이션 구분선은 합치지 않는다 — 두 번 이동한 것은 다른 사실이다', () => {
    const nav = entry({ kind: 'navigation', level: 'info', text: 'http://x/' });
    expect(mergeRepeatedLog(nav, nav)).toBeNull();
  });

  it('앞이 없으면 합치지 않는다', () => {
    expect(mergeRepeatedLog(undefined, entry({}))).toBeNull();
  });
});
