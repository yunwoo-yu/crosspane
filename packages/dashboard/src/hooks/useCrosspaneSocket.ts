import { useCallback, useEffect, useRef, useState } from 'react';
import { RECONNECT_DELAY_MS } from '../constants';
import {
  logEntryFromEvent,
  networkEntryFromEvent,
  reduceSessionMetas,
  reduceSessionStates,
  type SessionMetas,
  type SessionStates,
  screenEventFromEvent,
} from '../event-log';
import type { ServerEvent } from '../types';
import { useEventBatcher } from './useEventBatcher';

export interface CrosspaneConnection {
  connected: boolean;
  sessions: SessionMetas;
  sessionStates: SessionStates;
  logs: ReturnType<typeof useEventBatcher>['logs'];
  networkEntries: ReturnType<typeof useEventBatcher>['networkEntries'];
  /** 세션별 rrweb 이벤트 — 화면 기록 플러그인을 쓰는 세션만 채워진다 */
  screenEvents: Record<string, unknown[]>;
  clearLogs: () => void;
}

/**
 * 허브 WS 연결 수명주기 + 조립부. 로직은 책임별 모듈에 있다:
 * - 이벤트→상태 전이 규칙: event-log.ts (순수 함수)
 * - 로그/네트워크 배칭: useEventBatcher (로그 폭주 시 리렌더 상한)
 */
export function useCrosspaneSocket(): CrosspaneConnection {
  const socketRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [sessions, setSessions] = useState<SessionMetas>({});
  const [sessionStates, setSessionStates] = useState<SessionStates>({});

  const batcher = useEventBatcher();
  const { appendLog, appendNetwork, appendScreen, clear: clearBatched } = batcher;

  const handleServerEvent = useCallback(
    (event: ServerEvent) => {
      // hello는 접속당 1회의 세션 경계다 — 서버가 접속마다 히스토리를 전량
      // 재생하므로, 이전 분을 비우지 않으면 재접속마다 로그가 중복 누적된다
      if (event.type === 'hello') clearBatched();
      const screen = screenEventFromEvent(event);
      if (screen) {
        appendScreen(screen.sessionId, screen.data);
        return;
      }
      setSessions((prev) => reduceSessionMetas(prev, event));
      setSessionStates((prev) => reduceSessionStates(prev, event));
      const networkEntry = networkEntryFromEvent(event);
      if (networkEntry) {
        appendNetwork(networkEntry);
        return;
      }
      const logEntry = logEntryFromEvent(event);
      if (logEntry) appendLog(logEntry);
    },
    [appendLog, appendNetwork, appendScreen, clearBatched],
  );

  useEffect(() => {
    let disposed = false;
    let retryTimer: number | null = null;

    const connect = (): void => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const socket = new WebSocket(`${proto}://${location.host}/ws`);
      socketRef.current = socket;
      socket.onopen = () => setConnected(true);
      // 허브 재시작 등으로 끊기면 자동 재접속한다.
      // 좀비 소켓 가드: 이전 소켓의 늦은 close/message가 새 소켓의 상태를
      // 덮어쓰지 않게 한다 (StrictMode 재마운트·재접속 레이스에서 실제 발생)
      socket.onclose = () => {
        if (socketRef.current !== socket) return;
        setConnected(false);
        if (!disposed) retryTimer = window.setTimeout(connect, RECONNECT_DELAY_MS);
      };
      socket.onmessage = (ev: MessageEvent<string>) => {
        if (socketRef.current !== socket) return;
        handleServerEvent(JSON.parse(ev.data) as ServerEvent);
      };
    };

    connect();
    return () => {
      disposed = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      socketRef.current?.close();
    };
  }, [handleServerEvent]);

  return {
    connected,
    sessions,
    sessionStates,
    logs: batcher.logs,
    networkEntries: batcher.networkEntries,
    screenEvents: batcher.screenEvents,
    clearLogs: batcher.clear,
  };
}
