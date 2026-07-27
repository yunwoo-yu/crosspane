import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClientMessage, EngineName, LogEntry, ServerMessage } from './types';

const MAX_LOGS = 500;

const ENGINE_LABEL: Record<EngineName, string> = {
  chromium: 'Chromium · Android WebView',
  webkit: 'WebKit · iOS WKWebView',
  firefox: 'Firefox · Gecko',
};

interface EngineState {
  frame?: string;
  status: 'starting' | 'ready' | 'error';
  detail?: string;
}

export default function App() {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [hello, setHello] = useState<Extract<ServerMessage, { type: 'hello' }> | null>(null);
  const [engines, setEngines] = useState<Partial<Record<EngineName, EngineState>>>({});
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logFilter, setLogFilter] = useState<EngineName | 'all'>('all');
  const logIdRef = useRef(0);
  const logEndRef = useRef<HTMLDivElement | null>(null);

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
    ws.onmessage = (ev) => {
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
          pushLog({ engine: msg.engine, kind: 'console', level: msg.level, text: msg.text, ts: msg.ts });
          break;
        case 'pageerror':
          pushLog({ engine: msg.engine, kind: 'pageerror', level: 'error', text: msg.message, ts: msg.ts });
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

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [logs]);

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  const visibleLogs = useMemo(
    () => (logFilter === 'all' ? logs : logs.filter((l) => l.engine === logFilter)),
    [logs, logFilter],
  );

  const errorCount = useCallback(
    (engine: EngineName) => logs.filter((l) => l.engine === engine && l.level === 'error').length,
    [logs],
  );

  const engineNames = hello?.engines ?? [];

  return (
    <div className="app">
      <header className="toolbar">
        <span className="brand">crosspane</span>
        <span className={`conn ${connected ? 'on' : 'off'}`}>{connected ? 'connected' : 'disconnected'}</span>
        {hello && (
          <>
            <span className="target">{hello.url}</span>
            <span className="device">{hello.device}</span>
          </>
        )}
        <button onClick={() => send({ type: 'reload' })}>⟳ reload all</button>
        <button onClick={() => setLogs([])}>clear logs</button>
      </header>

      <main className="grid" style={{ gridTemplateColumns: `repeat(${Math.max(engineNames.length, 1)}, 1fr)` }}>
        {engineNames.map((engine) => {
          const st = engines[engine];
          const errors = errorCount(engine);
          return (
            <section key={engine} className="pane">
              <div className="pane-head">
                <span className={`dot ${st?.status ?? 'starting'}`} />
                <span className="pane-title">{ENGINE_LABEL[engine]}</span>
                {errors > 0 && <span className="err-badge">{errors}</span>}
              </div>
              <div className="pane-screen">
                {st?.frame ? (
                  <img
                    src={`data:image/jpeg;base64,${st.frame}`}
                    alt={engine}
                    draggable={false}
                    onPointerDown={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      send({
                        type: 'click',
                        x: (e.clientX - rect.left) / rect.width,
                        y: (e.clientY - rect.top) / rect.height,
                      });
                    }}
                    onWheel={(e) => send({ type: 'scroll', deltaY: e.deltaY })}
                  />
                ) : (
                  <div className="placeholder">
                    {st?.status === 'error' ? `failed: ${st.detail ?? 'unknown'}` : 'starting…'}
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </main>

      <section className="console">
        <div className="console-head">
          <span>console</span>
          <div className="filters">
            {(['all', ...engineNames] as const).map((f) => (
              <button
                key={f}
                className={logFilter === f ? 'active' : ''}
                onClick={() => setLogFilter(f as EngineName | 'all')}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="console-body">
          {visibleLogs.map((l) => (
            <div key={l.id} className={`log-line ${l.level === 'error' ? 'error' : l.level === 'warning' ? 'warn' : ''}`}>
              <span className={`log-engine ${l.engine}`}>{l.engine}</span>
              <span className="log-kind">{l.kind === 'console' ? l.level : l.kind}</span>
              <span className="log-text">{l.text}</span>
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </section>
    </div>
  );
}
