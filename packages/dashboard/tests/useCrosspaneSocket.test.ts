import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCrosspaneSocket } from '../src/hooks/useCrosspaneSocket';
import type { ServerEvent, SessionMeta } from '../src/types';

/** jsdom에는 WebSocket이 없다 — 서버 푸시를 흉내내는 최소 대역 */
class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: MessageEvent<string>) => void) | null = null;
  readyState = 1;
  close = vi.fn(() => {
    this.readyState = 3;
    this.onclose?.();
  });

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  emit(event: ServerEvent): void {
    this.onmessage?.({ data: JSON.stringify(event) } as MessageEvent<string>);
  }
}

const session = (id: string): SessionMeta => ({
  id,
  label: `session ${id}`,
  userAgent: 'ua',
  startedAt: 0,
});

describe('useCrosspaneSocket', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const latest = () => FakeSocket.instances[FakeSocket.instances.length - 1];

  it('연결되면 connected=true, 세션/로그 이벤트가 상태에 반영된다', async () => {
    const { result } = renderHook(() => useCrosspaneSocket());
    act(() => latest().onopen?.());
    expect(result.current.connected).toBe(true);

    act(() => {
      latest().emit({ type: 'hello', sessions: [session('a')] });
      latest().emit({ type: 'console', sessionId: 'a', level: 'log', text: 'hi', ts: 1 });
    });
    await waitFor(() => {
      expect(Object.keys(result.current.sessions)).toEqual(['a']);
      expect(result.current.logs.map((l) => l.text)).toEqual(['hi']);
    });
  });

  it('재접속 hello는 이전 로그를 비운다 (중복 누적 방지)', async () => {
    const { result } = renderHook(() => useCrosspaneSocket());
    act(() => {
      latest().onopen?.();
      latest().emit({ type: 'hello', sessions: [session('a')] });
      latest().emit({ type: 'console', sessionId: 'a', level: 'log', text: 'first', ts: 1 });
    });
    await waitFor(() => expect(result.current.logs).toHaveLength(1));

    // 서버는 재접속마다 히스토리를 전량 재생한다 — hello가 세션 경계
    act(() => latest().emit({ type: 'hello', sessions: [session('a')] }));
    act(() =>
      latest().emit({ type: 'console', sessionId: 'a', level: 'log', text: 'first', ts: 1 }),
    );
    await waitFor(() => expect(result.current.logs.map((l) => l.text)).toEqual(['first']));
  });

  it('연결이 끊기면 재접속을 예약한다', async () => {
    vi.useFakeTimers();
    renderHook(() => useCrosspaneSocket());
    act(() => latest().onopen?.());
    const before = FakeSocket.instances.length;
    act(() => latest().onclose?.());
    act(() => vi.advanceTimersByTime(1_500));
    expect(FakeSocket.instances.length).toBeGreaterThan(before);
  });

  it('좀비 소켓: 이전 소켓의 늦은 메시지는 무시한다', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCrosspaneSocket());
    const stale = latest();
    act(() => stale.onopen?.());
    act(() => stale.onclose?.());
    act(() => vi.advanceTimersByTime(1_500)); // 새 소켓 생성
    expect(latest()).not.toBe(stale);

    act(() => stale.emit({ type: 'console', sessionId: 'a', level: 'log', text: 'zombie', ts: 1 }));
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.logs).toHaveLength(0);
  });

  it('화면 이벤트는 세션별 버퍼로, 로그·네트워크와 섞지 않는다', async () => {
    const { result } = renderHook(() => useCrosspaneSocket());
    await waitFor(() => expect(FakeSocket.instances.length).toBe(1));

    act(() => {
      latest().emit({ type: 'hello', sessions: [session('a')] });
      latest().emit({
        type: 'screen',
        sessionId: 'a',
        format: 'rrweb',
        data: { type: 2 },
        ts: 1,
      });
    });

    await waitFor(() => expect(result.current.screenEvents.a).toHaveLength(1));
    expect(result.current.logs).toHaveLength(0);
    expect(result.current.networkEntries).toHaveLength(0);
  });

  it('네트워크 이벤트는 네트워크 목록으로만 간다', async () => {
    const { result } = renderHook(() => useCrosspaneSocket());
    await waitFor(() => expect(FakeSocket.instances.length).toBe(1));

    act(() => {
      latest().emit({ type: 'hello', sessions: [session('a')] });
      latest().emit({
        type: 'network',
        sessionId: 'a',
        method: 'POST',
        url: 'https://api.test/pay',
        status: 502,
        durationMs: 12,
        ts: 1,
      });
    });

    await waitFor(() => expect(result.current.networkEntries).toHaveLength(1));
    expect(result.current.networkEntries[0]).toMatchObject({
      status: 502,
      url: 'https://api.test/pay',
    });
    expect(result.current.logs).toHaveLength(0);
  });

  it('session-left는 세션을 지우지 않고 live만 내린다 (사후 분석 유지)', async () => {
    const { result } = renderHook(() => useCrosspaneSocket());
    act(() => {
      latest().onopen?.();
      latest().emit({ type: 'hello', sessions: [session('a')] });
      latest().emit({ type: 'session-left', sessionId: 'a', ts: 2 });
    });
    await waitFor(() => {
      expect(result.current.sessions.a).toBeDefined();
      expect(result.current.sessionStates.a.live).toBe(false);
    });
  });
});
