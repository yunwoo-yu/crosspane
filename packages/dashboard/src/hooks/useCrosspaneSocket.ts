import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_LOGS, RECONNECT_DELAY_MS } from '../constants';
import {
  type ClientCommand,
  ENGINE_NAMES_BY_CODE,
  type EngineName,
  type EngineState,
  type FrameListener,
  type HelloEvent,
  type LogEntry,
  type ServerEvent,
} from '../types';

export interface CrosspaneConnection {
  connected: boolean;
  hello: HelloEvent | null;
  engineStates: Partial<Record<EngineName, EngineState>>;
  logs: LogEntry[];
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

  // 로그가 무한히 쌓이면 리렌더 비용이 커지므로 최근 MAX_LOGS개만 유지한다
  const appendLog = useCallback((entry: Omit<LogEntry, 'id'>) => {
    setLogs((prev) => {
      const next = [...prev, { ...entry, id: logIdRef.current++ }];
      return next.length > MAX_LOGS ? next.slice(-MAX_LOGS) : next;
    });
  }, []);

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
          setEngineStates((prev) => ({
            ...prev,
            [event.engine]: { status: event.status, detail: event.detail },
          }));
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
    [appendLog],
  );

  const handleFramePacket = useCallback((packet: ArrayBuffer) => {
    const bytes = new Uint8Array(packet);
    const engine = ENGINE_NAMES_BY_CODE[bytes[0]];
    if (!engine) return;
    const listeners = frameListenersRef.current.get(engine);
    if (!listeners || listeners.size === 0) return;
    const jpegBlob = new Blob([bytes.subarray(1)], { type: 'image/jpeg' });
    // createImageBitmap은 디코딩을 메인 스레드 밖에서 수행한다
    void createImageBitmap(jpegBlob).then((frame) => {
      for (const listener of listeners) listener(frame);
      frame.close();
    });
  }, []);

  useEffect(() => {
    let disposed = false;
    let retryTimer: number | null = null;

    const connect = (): void => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const socket = new WebSocket(`${proto}://${location.host}/ws`);
      socket.binaryType = 'arraybuffer';
      socketRef.current = socket;
      socket.onopen = () => setConnected(true);
      // CLI 재시작 등으로 끊기면 자동 재접속한다
      socket.onclose = () => {
        setConnected(false);
        if (!disposed) retryTimer = window.setTimeout(connect, RECONNECT_DELAY_MS);
      };
      socket.onmessage = (ev: MessageEvent<string | ArrayBuffer>) => {
        if (typeof ev.data === 'string') {
          handleServerEvent(JSON.parse(ev.data) as ServerEvent);
        } else {
          handleFramePacket(ev.data);
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      socketRef.current?.close();
    };
  }, [handleServerEvent, handleFramePacket]);

  const sendCommand = useCallback((command: ClientCommand) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(command));
  }, []);

  const clearLogs = useCallback(() => setLogs([]), []);

  const subscribeToFrames = useCallback((engine: EngineName, listener: FrameListener) => {
    const listenersByEngine = frameListenersRef.current;
    let listeners = listenersByEngine.get(engine);
    if (!listeners) {
      listeners = new Set();
      listenersByEngine.set(engine, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return { connected, hello, engineStates, logs, sendCommand, clearLogs, subscribeToFrames };
}
