import { useCallback, useEffect, useRef, useState } from 'react';
import { EVENT_BATCH_MS, MAX_LOGS, MAX_NETWORK_ENTRIES } from '../constants';
import type { LogEntry, NetworkEntry } from '../types';

/**
 * 로그/네트워크 이벤트 배칭 — 이벤트 폭주 시 이벤트당 setState는
 * O(n) 복사 × 리렌더를 초당 수백 회 유발한다. 펜딩 버퍼에 모았다가
 * EVENT_BATCH_MS마다 한 번에 반영한다 (상한은 반영 시점에 적용).
 */
export function useEventBatcher() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [networkEntries, setNetworkEntries] = useState<NetworkEntry[]>([]);
  const idRef = useRef(0);
  const pendingLogsRef = useRef<LogEntry[]>([]);
  const pendingNetworkRef = useRef<NetworkEntry[]>([]);
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
          const next = [...prev, ...batch];
          return next.length > MAX_LOGS ? next.slice(-MAX_LOGS) : next;
        });
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
      pendingLogsRef.current.push({ ...entry, id: idRef.current++ });
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

  /** 펜딩 버퍼까지 즉시 비운다 — clearLogs 버튼과 세션 경계(hello) 공용 */
  const clear = useCallback(() => {
    pendingLogsRef.current = [];
    pendingNetworkRef.current = [];
    setLogs([]);
    setNetworkEntries([]);
  }, []);

  return { logs, networkEntries, appendLog, appendNetwork, clear };
}
