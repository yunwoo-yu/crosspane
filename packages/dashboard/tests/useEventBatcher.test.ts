import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EVENT_BATCH_MS, MAX_LOGS, MAX_NETWORK_ENTRIES } from '../src/constants';
import { useEventBatcher } from '../src/hooks/useEventBatcher';
import type { LogEntry, NetworkEntry } from '../src/types';

/**
 * 배칭은 성능 안전장치이면서 **정확성 계약**이기도 하다:
 * 상한은 반영 시점에 적용되고, `clear()`는 펜딩 버퍼까지 비운다
 * (hello 세션 경계에서 비우지 않으면 로그가 중복 누적된다 — 실측 버그).
 */

const log = (text: string): Omit<LogEntry, 'id'> => ({
  sessionId: 's1',
  level: 'log',
  text,
  ts: 1,
});

const network = (url: string): Omit<NetworkEntry, 'id'> => ({
  sessionId: 's1',
  method: 'GET',
  url,
  status: 200,
  durationMs: 1,
  ts: 1,
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** 배칭 창을 넘겨 플러시시킨다 — 실시간 sleep은 CI에서 흔들린다 */
function flush(): void {
  act(() => {
    vi.advanceTimersByTime(EVENT_BATCH_MS + 1);
  });
}

describe('useEventBatcher', () => {
  it('플러시 전에는 상태를 바꾸지 않는다 (이벤트당 리렌더 방지)', () => {
    const { result } = renderHook(() => useEventBatcher());

    act(() => {
      result.current.appendLog(log('a'));
      result.current.appendLog(log('b'));
    });
    expect(result.current.logs).toHaveLength(0);

    flush();
    expect(result.current.logs.map((entry) => entry.text)).toEqual(['a', 'b']);
  });

  it('여러 종류를 한 번의 플러시로 함께 반영한다', () => {
    const { result } = renderHook(() => useEventBatcher());

    act(() => {
      result.current.appendLog(log('a'));
      result.current.appendNetwork(network('/x'));
      result.current.appendScreen('s1', { type: 2 });
    });
    flush();

    expect(result.current.logs).toHaveLength(1);
    expect(result.current.networkEntries).toHaveLength(1);
    expect(result.current.screenEvents.s1).toHaveLength(1);
  });

  it('엔트리마다 유일한 id를 부여한다 (React key 충돌 방지)', () => {
    const { result } = renderHook(() => useEventBatcher());

    act(() => {
      result.current.appendLog(log('a'));
      result.current.appendNetwork(network('/x'));
      result.current.appendLog(log('b'));
    });
    flush();

    const ids = [
      ...result.current.logs.map((entry) => entry.id),
      ...result.current.networkEntries.map((entry) => entry.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  describe('상한은 반영 시점에 적용된다', () => {
    it('로그 상한을 넘으면 오래된 것부터 버린다', () => {
      const { result } = renderHook(() => useEventBatcher());

      act(() => {
        for (let i = 0; i < MAX_LOGS + 10; i++) result.current.appendLog(log(`line${i}`));
      });
      flush();

      expect(result.current.logs).toHaveLength(MAX_LOGS);
      // 최신이 남아야 한다 — 실패 직전 맥락이 뒤쪽에 있다
      expect(result.current.logs.at(-1)?.text).toBe(`line${MAX_LOGS + 9}`);
      expect(result.current.logs[0].text).toBe('line10');
    });

    it('네트워크 상한도 같은 방식으로 적용된다', () => {
      const { result } = renderHook(() => useEventBatcher());

      act(() => {
        for (let i = 0; i < MAX_NETWORK_ENTRIES + 5; i++) {
          result.current.appendNetwork(network(`/req${i}`));
        }
      });
      flush();

      expect(result.current.networkEntries).toHaveLength(MAX_NETWORK_ENTRIES);
      expect(result.current.networkEntries.at(-1)?.url).toBe(`/req${MAX_NETWORK_ENTRIES + 4}`);
    });

    it('연속 배치를 누적하면서 상한을 유지한다', () => {
      const { result } = renderHook(() => useEventBatcher());

      for (let batch = 0; batch < 3; batch++) {
        act(() => {
          for (let i = 0; i < MAX_LOGS / 2; i++) result.current.appendLog(log(`b${batch}-${i}`));
        });
        flush();
      }
      expect(result.current.logs).toHaveLength(MAX_LOGS);
    });
  });

  describe('화면 이벤트', () => {
    it('세션별로 분리해 쌓는다', () => {
      const { result } = renderHook(() => useEventBatcher());

      act(() => {
        result.current.appendScreen('s1', { type: 2 });
        result.current.appendScreen('s2', { type: 2 });
        result.current.appendScreen('s1', { type: 3 });
      });
      flush();

      expect(result.current.screenEvents.s1).toHaveLength(2);
      expect(result.current.screenEvents.s2).toHaveLength(1);
    });
  });

  describe('clear() — hello 세션 경계', () => {
    it('반영된 항목을 비운다', () => {
      const { result } = renderHook(() => useEventBatcher());

      act(() => {
        result.current.appendLog(log('a'));
      });
      flush();
      expect(result.current.logs).toHaveLength(1);

      act(() => {
        result.current.clear();
      });
      expect(result.current.logs).toHaveLength(0);
    });

    it('아직 플러시되지 않은 펜딩 버퍼까지 비운다', () => {
      // 이게 핵심이다: 재접속(hello) 직전에 도착한 이벤트가 펜딩에 남아 있으면
      // clear 이후 플러시가 그것을 되살려 히스토리와 중복된다 (실측 버그)
      const { result } = renderHook(() => useEventBatcher());

      act(() => {
        result.current.appendLog(log('stale'));
        result.current.appendNetwork(network('/stale'));
        result.current.appendScreen('s1', { type: 2 });
        result.current.clear();
      });
      flush();

      expect(result.current.logs).toHaveLength(0);
      expect(result.current.networkEntries).toHaveLength(0);
      expect(result.current.screenEvents).toEqual({});
    });

    it('비운 뒤 도착한 이벤트는 정상 반영된다', () => {
      const { result } = renderHook(() => useEventBatcher());

      act(() => {
        result.current.appendLog(log('stale'));
        result.current.clear();
        result.current.appendLog(log('fresh'));
      });
      flush();

      expect(result.current.logs.map((entry) => entry.text)).toEqual(['fresh']);
    });
  });

  it('언마운트 후에는 플러시 타이머가 돌지 않는다 (React 경고·누수 방지)', () => {
    const { result, unmount } = renderHook(() => useEventBatcher());

    act(() => {
      result.current.appendLog(log('a'));
    });
    unmount();

    expect(() => {
      vi.advanceTimersByTime(EVENT_BATCH_MS * 4);
    }).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });
});
