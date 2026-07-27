import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_LOGS } from '../constants';
import type {
  ClientMessage,
  EngineName,
  EngineState,
  HelloMessage,
  LogEntry,
  ServerMessage,
} from '../types';

export interface CrosspaneSocket {
  connected: boolean;
  hello: HelloMessage | null;
  engines: Partial<Record<EngineName, EngineState>>;
  logs: LogEntry[];
  send: (msg: ClientMessage) => void;
  clearLogs: () => void;
}

export function useCrosspaneSocket(): CrosspaneSocket {
  const wsRef = useRef<WebSocket | null>(null);
  const logIdRef = useRef(0);
  const [connected, setConnected] = useState(false);
  const [hello, setHello] = useState<HelloMessage | null>(null);
  const [engines, setEngines] = useState<Partial<Record<EngineName, EngineState>>>({});
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const pushLog = useCallback((entry: Omit<LogEntry, 'id'>) => {
    setLogs((prev) => {
      const next = [...prev, { ...entry, id: logIdRef.current++ }];
      return next.length > MAX_LOGS ? next.slice(-MAX_LOGS) : next;
    });
  }, []);

  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    wsRef.current = ws;
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (ev: MessageEvent<string>) => {
      const msg = JSON.parse(ev.data) as ServerMessage;
      switch (msg.type) {
        case 'hello':
          setHello(msg);
          setEngines(Object.fromEntries(msg.engines.map((e) => [e, { status: 'starting' }])));
          break;
        case 'frame':
          setEngines((prev) => ({
            ...prev,
            [msg.engine]: { ...prev[msg.engine], status: 'ready', frame: msg.data },
          }));
          break;
        case 'engine-status':
          setEngines((prev) => ({
            ...prev,
            [msg.engine]: { ...prev[msg.engine], status: msg.status, detail: msg.detail },
          }));
          break;
        case 'console':
          pushLog({
            engine: msg.engine,
            kind: 'console',
            level: msg.level,
            text: msg.text,
            ts: msg.ts,
          });
          break;
        case 'pageerror':
          pushLog({
            engine: msg.engine,
            kind: 'pageerror',
            level: 'error',
            text: msg.message,
            ts: msg.ts,
          });
          break;
        case 'requestfailed':
          pushLog({
            engine: msg.engine,
            kind: 'requestfailed',
            level: 'error',
            text: `${msg.url} — ${msg.error}`,
            ts: msg.ts,
          });
          break;
      }
    };
    return () => ws.close();
  }, [pushLog]);

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  const clearLogs = useCallback(() => setLogs([]), []);

  return { connected, hello, engines, logs, send, clearLogs };
}
