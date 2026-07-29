import { useCallback, useEffect, useRef, useState } from 'react';
import { EVENT_BATCH_MS, MAX_LOGS, MAX_NETWORK_ENTRIES, MAX_SCREEN_EVENTS } from '../constants';
import { mergeRepeatedLog } from '../event-log';
import { mergeScreenEvents } from '../screen-events';
import type { LogEntry, NetworkEntry } from '../types';

/**
 * 로그/네트워크/화면 이벤트 배칭 — 이벤트 폭주 시 이벤트당 setState는
 * O(n) 복사 × 리렌더를 초당 수백 회 유발한다. 펜딩 버퍼에 모았다가
 * EVENT_BATCH_MS마다 한 번에 반영한다 (상한은 반영 시점에 적용).
 *
 * 화면(rrweb) 이벤트가 특히 많다 — DOM 변경마다 발생하므로 배칭 없이는
 * 재생 기록을 켜는 순간 대시보드가 리렌더로 굳는다.
 */
export function useEventBatcher() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [networkEntries, setNetworkEntries] = useState<NetworkEntry[]>([]);
  const [screenEvents, setScreenEvents] = useState<Record<string, unknown[]>>({});
  const idRef = useRef(0);
  const pendingLogsRef = useRef<LogEntry[]>([]);
  const pendingNetworkRef = useRef<NetworkEntry[]>([]);
  const pendingScreenRef = useRef<Record<string, unknown[]>>({});
  const flushTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current);
    },
    [],
  );

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current !== null) return;
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      if (pendingLogsRef.current.length > 0) {
        const batch = pendingLogsRef.current;
        pendingLogsRef.current = [];
        setLogs((prev) => {
          // 배치 경계에서 갈린 런을 이어 붙인다 — 상한이 서로 다른 엔트리를 담아야
          // 원인 로그가 스팸에 밀려나지 않는다
          const next = [...prev];
          for (const entry of batch) {
            const merged = mergeRepeatedLog(next[next.length - 1], entry);
            if (merged) next[next.length - 1] = merged;
            else next.push(entry);
          }
          return next.length > MAX_LOGS ? next.slice(-MAX_LOGS) : next;
        });
      }
      if (Object.keys(pendingScreenRef.current).length > 0) {
        const batch = pendingScreenRef.current;
        pendingScreenRef.current = {};
        setScreenEvents((prev) => mergeScreenEvents(prev, batch, MAX_SCREEN_EVENTS));
      }
      if (pendingNetworkRef.current.length > 0) {
        const batch = pendingNetworkRef.current;
        pendingNetworkRef.current = [];
        setNetworkEntries((prev) => {
          const next = [...prev, ...batch];
          return next.length > MAX_NETWORK_ENTRIES ? next.slice(-MAX_NETWORK_ENTRIES) : next;
        });
      }
    }, EVENT_BATCH_MS);
  }, []);

  const appendLog = useCallback(
    (entry: Omit<LogEntry, 'id'>) => {
      // 펜딩 안에서 먼저 합친다 — 폭주 시 id 소비와 배열 성장을 함께 막는다
      const pending = pendingLogsRef.current;
      const merged = mergeRepeatedLog(pending[pending.length - 1], entry);
      if (merged) {
        pending[pending.length - 1] = merged;
        scheduleFlush();
        return;
      }
      pending.push({ ...entry, id: idRef.current++ });
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const appendNetwork = useCallback(
    (entry: Omit<NetworkEntry, 'id'>) => {
      pendingNetworkRef.current.push({ ...entry, id: idRef.current++ } as NetworkEntry);
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const appendScreen = useCallback(
    (sessionId: string, data: unknown) => {
      const pending = pendingScreenRef.current;
      pending[sessionId] = pending[sessionId] ?? [];
      pending[sessionId].push(data);
      scheduleFlush();
    },
    [scheduleFlush],
  );

  /** 펜딩 버퍼까지 즉시 비운다 — clearLogs 버튼과 세션 경계(hello) 공용 */
  const clear = useCallback(() => {
    pendingLogsRef.current = [];
    pendingNetworkRef.current = [];
    pendingScreenRef.current = {};
    setLogs([]);
    setNetworkEntries([]);
    setScreenEvents({});
  }, []);

  return { logs, networkEntries, screenEvents, appendLog, appendNetwork, appendScreen, clear };
}
