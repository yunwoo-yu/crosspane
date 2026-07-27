import { useCallback, useEffect, useRef, useState } from 'react';
import { EVENT_BATCH_MS, MAX_LOGS, MAX_NETWORK_ENTRIES, RECONNECT_DELAY_MS } from '../constants';
import {
  type ClientCommand,
  ENGINE_NAMES_BY_CODE,
  type EngineName,
  type EngineState,
  FRAME_FLAG_FULL_PAGE,
  FRAME_HEADER_BYTES,
  type FrameListener,
  type HelloEvent,
  type LogEntry,
  type NetworkEntry,
  PACKET_TYPE_FRAME,
  PACKET_TYPE_VIDEO,
  SCROLL_Y_UNKNOWN,
  type ServerEvent,
  VIDEO_HEADER_BYTES,
} from '../types';
import { useVideoStreams } from './useVideoStreams';

export interface CrosspaneConnection {
  connected: boolean;
  hello: HelloEvent | null;
  engineStates: Partial<Record<EngineName, EngineState>>;
  logs: LogEntry[];
  networkEntries: NetworkEntry[];
  sendCommand: (command: ClientCommand) => void;
  clearLogs: () => void;
  /**
   * 엔진의 프레임 스트림을 구독한다. 프레임은 React 상태를 거치지 않고
   * 구독자(canvas)에 직접 전달된다 — 고프레임에서 리렌더 비용을 없애기 위함.
   * 반환값은 구독 해제 함수. 전달된 ImageBitmap은 콜백 밖으로 유출하면 안 된다(호출 후 close됨).
   */
  subscribeToFrames: (engine: EngineName, listener: FrameListener) => () => void;
}

export function useCrosspaneSocket(): CrosspaneConnection {
  const socketRef = useRef<WebSocket | null>(null);
  const logIdRef = useRef(0);
  const frameListenersRef = useRef(new Map<EngineName, Set<FrameListener>>());
  const [connected, setConnected] = useState(false);
  const [hello, setHello] = useState<HelloEvent | null>(null);
  const [engineStates, setEngineStates] = useState<Partial<Record<EngineName, EngineState>>>({});
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [networkEntries, setNetworkEntries] = useState<NetworkEntry[]>([]);

  // 이벤트 폭주 시 이벤트당 setState는 O(n) 복사 × 리렌더를 초당 수백 회 유발한다 —
  // 펜딩 버퍼에 모았다가 EVENT_BATCH_MS마다 한 번에 반영한다 (상한은 반영 시점에 적용)
  const pendingLogsRef = useRef<LogEntry[]>([]);
  const pendingNetworkRef = useRef<NetworkEntry[]>([]);
  const flushTimerRef = useRef<number | null>(null);

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
      pendingLogsRef.current.push({ ...entry, id: logIdRef.current++ });
      scheduleFlush();
    },
    [scheduleFlush],
  );

  /** 디코딩된 프레임(스냅샷/비디오 공통)을 구독자에게 전달하고 close한다 */
  const dispatchFrame = useCallback(
    (engine: EngineName, frame: ImageBitmap, scrollY: number, fullPage = false) => {
      const listeners = frameListenersRef.current.get(engine);
      if (listeners && listeners.size > 0) {
        for (const listener of listeners) listener(frame, scrollY, fullPage);
      }
      frame.close();
    },
    [],
  );

  // 실시간 비디오 스트림(H.264) — 디코드 결과는 스냅샷 프레임과 같은 경로로 흐른다
  const { pushVideoChunk, resetPipeline } = useVideoStreams((engine, frame) =>
    dispatchFrame(engine, frame, SCROLL_Y_UNKNOWN),
  );

  const handleServerEvent = useCallback(
    (event: ServerEvent) => {
      switch (event.type) {
        case 'hello':
          setHello(event);
          setEngineStates(
            Object.fromEntries(event.engines.map((engine) => [engine, { status: 'starting' }])),
          );
          break;
        case 'engine-status':
          if (event.status === 'stopped') resetPipeline(event.engine);
          setEngineStates((prev) => ({
            ...prev,
            [event.engine]: {
              ...prev[event.engine],
              status: event.status,
              detail: event.detail,
              viewOnly: event.viewOnly ?? prev[event.engine]?.viewOnly,
            },
          }));
          break;
        case 'navigation':
          // 기존 상태(viewOnly/detail)를 반드시 보존할 것 — 새 객체로 갈아끼우면
          // 셸 모드가 해제한 view-only가 내비게이션마다 되살아난다 (실측 버그)
          setEngineStates((prev) => ({
            ...prev,
            [event.engine]: {
              ...prev[event.engine],
              status: prev[event.engine]?.status ?? 'ready',
              currentUrl: event.url,
            },
          }));
          // 콘솔 타임라인에 구분선으로도 남긴다 — 리로드/이동 피드백 겸 로그 구간 구분
          appendLog({
            engine: event.engine,
            kind: 'navigation',
            level: 'info',
            text: event.url,
            ts: event.ts,
          });
          break;
        case 'network':
          pendingNetworkRef.current.push({ ...event, id: logIdRef.current++ });
          scheduleFlush();
          break;
        case 'httperror':
          appendLog({
            engine: event.engine,
            kind: 'httperror',
            level: 'error',
            text: `HTTP ${event.status} — ${event.url}`,
            ts: event.ts,
          });
          break;
        case 'console':
          appendLog({
            engine: event.engine,
            kind: 'console',
            level: event.level,
            text: event.text,
            ts: event.ts,
          });
          break;
        case 'pageerror':
          appendLog({
            engine: event.engine,
            kind: 'pageerror',
            level: 'error',
            text: event.message,
            ts: event.ts,
          });
          break;
        case 'requestfailed':
          appendLog({
            engine: event.engine,
            kind: 'requestfailed',
            level: 'error',
            text: `${event.url} — ${event.error}`,
            ts: event.ts,
          });
          break;
      }
    },
    [appendLog, scheduleFlush, resetPipeline],
  );

  const handleBinaryPacket = useCallback(
    (packet: ArrayBuffer) => {
      const bytes = new Uint8Array(packet);
      const engine = ENGINE_NAMES_BY_CODE[bytes[1]];
      if (!engine) return;
      if (bytes[0] === PACKET_TYPE_VIDEO) {
        if (bytes.length > VIDEO_HEADER_BYTES)
          pushVideoChunk(engine, bytes.subarray(VIDEO_HEADER_BYTES));
        return;
      }
      if (bytes[0] !== PACKET_TYPE_FRAME || bytes.length <= FRAME_HEADER_BYTES) return;
      // 구독자가 없는 프레임은 디코딩 자체를 생략한다 (숨김 pane 비용 0)
      const listeners = frameListenersRef.current.get(engine);
      if (!listeners || listeners.size === 0) return;
      // 헤더: flags(bit0=풀페이지) + scrollY(이 프레임이 반영하는 실제 스크롤 위치)
      const fullPage = (bytes[2] & FRAME_FLAG_FULL_PAGE) !== 0;
      const scrollY = new DataView(packet).getInt32(3, true);
      const jpegBlob = new Blob([bytes.subarray(FRAME_HEADER_BYTES)], { type: 'image/jpeg' });
      // createImageBitmap은 디코딩을 메인 스레드 밖에서 수행한다
      void createImageBitmap(jpegBlob).then((frame) =>
        dispatchFrame(engine, frame, scrollY, fullPage),
      );
    },
    [pushVideoChunk, dispatchFrame],
  );

  const sendCommand = useCallback((command: ClientCommand) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(command));
  }, []);

  /** 현재 프레임 구독 중인 엔진 목록을 서버에 알린다 — 안 보는 pane은 서버가 캡처를 끈다 */
  const sendWatchedEngines = useCallback(() => {
    const engines = [...frameListenersRef.current.entries()]
      .filter(([, listeners]) => listeners.size > 0)
      .map(([engine]) => engine);
    sendCommand({ type: 'watch', engines });
  }, [sendCommand]);

  useEffect(() => {
    let disposed = false;
    let retryTimer: number | null = null;

    const connect = (): void => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const socket = new WebSocket(`${proto}://${location.host}/ws`);
      socket.binaryType = 'arraybuffer';
      socketRef.current = socket;
      socket.onopen = () => {
        setConnected(true);
        // 재접속 시 현재 시청 목록을 다시 알린다 (서버는 미전송 클라이언트를 전체 시청으로 간주)
        sendWatchedEngines();
      };
      // CLI 재시작 등으로 끊기면 자동 재접속한다
      socket.onclose = () => {
        setConnected(false);
        if (!disposed) retryTimer = window.setTimeout(connect, RECONNECT_DELAY_MS);
      };
      socket.onmessage = (ev: MessageEvent<string | ArrayBuffer>) => {
        if (typeof ev.data === 'string') {
          handleServerEvent(JSON.parse(ev.data) as ServerEvent);
        } else {
          handleBinaryPacket(ev.data);
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current);
      socketRef.current?.close();
    };
  }, [handleServerEvent, handleBinaryPacket, sendWatchedEngines]);

  const clearLogs = useCallback(() => {
    pendingLogsRef.current = [];
    pendingNetworkRef.current = [];
    setLogs([]);
    setNetworkEntries([]);
  }, []);

  const subscribeToFrames = useCallback(
    (engine: EngineName, listener: FrameListener) => {
      const listenersByEngine = frameListenersRef.current;
      let listeners = listenersByEngine.get(engine);
      if (!listeners) {
        listeners = new Set();
        listenersByEngine.set(engine, listeners);
      }
      listeners.add(listener);
      sendWatchedEngines();
      return () => {
        listeners.delete(listener);
        sendWatchedEngines();
      };
    },
    [sendWatchedEngines],
  );

  return {
    connected,
    hello,
    engineStates,
    logs,
    networkEntries,
    sendCommand,
    clearLogs,
    subscribeToFrames,
  };
}
