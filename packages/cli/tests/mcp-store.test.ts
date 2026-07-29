import type { SessionEvent, SessionMeta } from '@crosspane/protocol';
import { describe, expect, it } from 'vitest';
import { SessionStore } from '../src/mcp/store.js';

function meta(id: string, label = id): SessionMeta {
  return { id, label, userAgent: 'ua', startedAt: 1_000 };
}

function consoleEvent(sessionId: string, text: string): SessionEvent {
  return { type: 'console', sessionId, level: 'log', text, ts: 2_000 };
}

describe('SessionStore', () => {
  it('hello로 세션을 등록하고 이벤트를 쌓는다', () => {
    const store = new SessionStore();
    store.apply({ type: 'hello', sessions: [meta('s1')] });
    store.apply(consoleEvent('s1', 'hi'));

    const [session] = store.list();
    expect(session.meta.id).toBe('s1');
    expect(session.events).toHaveLength(1);
    expect(session.live).toBe(true);
  });

  it('hello는 세션 경계 — 재접속 시 히스토리 중복 누적을 막는다', () => {
    const store = new SessionStore();
    store.apply({ type: 'hello', sessions: [meta('s1')] });
    store.apply(consoleEvent('s1', 'hi'));
    // 허브가 재접속마다 히스토리를 전량 재생하므로 hello에서 비우지 않으면 두 배가 된다
    store.apply({ type: 'hello', sessions: [meta('s1')] });
    store.apply(consoleEvent('s1', 'hi'));

    expect(store.list()[0].events).toHaveLength(1);
  });

  it('등록되지 않은 세션의 이벤트는 버린다', () => {
    const store = new SessionStore();
    store.apply(consoleEvent('ghost', 'orphan'));
    expect(store.list()).toHaveLength(0);
  });

  it('session-left는 종료로 표시하고 히스토리는 유지한다', () => {
    const store = new SessionStore();
    store.apply({ type: 'session-joined', session: meta('s1') });
    store.apply(consoleEvent('s1', 'hi'));
    store.apply({ type: 'session-left', sessionId: 's1', ts: 9_000 });

    const [session] = store.list();
    expect(session.live).toBe(false);
    expect(session.endedAt).toBe(9_000);
    expect(session.events).toHaveLength(1);
  });

  it('같은 id로 재등록하면 히스토리를 이어간다', () => {
    const store = new SessionStore();
    store.apply({ type: 'session-joined', session: meta('s1') });
    store.apply(consoleEvent('s1', 'before'));
    store.apply({ type: 'session-left', sessionId: 's1', ts: 9_000 });
    store.apply({ type: 'session-joined', session: meta('s1') });

    const [session] = store.list();
    expect(session.live).toBe(true);
    expect(session.endedAt).toBeUndefined();
    expect(session.events).toHaveLength(1);
  });

  it('상한을 넘으면 오래된 것부터 버리고 버린 수를 남긴다', () => {
    const store = new SessionStore(2);
    store.apply({ type: 'session-joined', session: meta('s1') });
    for (const text of ['a', 'b', 'c', 'd']) store.apply(consoleEvent('s1', text));

    const [session] = store.list();
    expect(session.events).toHaveLength(2);
    expect(session.dropped).toBe(2);
    expect(session.events.map((event) => (event as { text: string }).text)).toEqual(['c', 'd']);
  });

  describe('resolve', () => {
    it('세션이 하나면 선택자를 생략할 수 있다', () => {
      const store = new SessionStore();
      store.apply({ type: 'hello', sessions: [meta('s1', 'checkout')] });
      expect(store.resolve(undefined)?.meta.id).toBe('s1');
    });

    it('여러 개면 생략 시 해석하지 않는다 — 조용히 아무거나 고르면 오답이 된다', () => {
      const store = new SessionStore();
      store.apply({ type: 'hello', sessions: [meta('s1'), meta('s2')] });
      expect(store.resolve(undefined)).toBeUndefined();
    });

    it('id · 라벨 · 라벨 부분일치 · id 접두사로 찾는다', () => {
      const store = new SessionStore();
      store.apply({
        type: 'hello',
        sessions: [meta('s-abc123', 'checkout webview'), meta('s-def456', 'home')],
      });
      expect(store.resolve('s-abc123')?.meta.label).toBe('checkout webview');
      expect(store.resolve('home')?.meta.id).toBe('s-def456');
      expect(store.resolve('CHECKOUT')?.meta.id).toBe('s-abc123');
      expect(store.resolve('s-abc')?.meta.id).toBe('s-abc123');
      expect(store.resolve('nope')).toBeUndefined();
    });
  });
});
