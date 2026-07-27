import { useEffect, useMemo, useRef, useState } from 'react';
import type { EngineName, LogEntry } from '../types';

interface ConsolePanelProps {
  logs: LogEntry[];
  engines: EngineName[];
}

type LogFilter = EngineName | 'all';

function levelClass(level: string): string {
  if (level === 'error') return 'error';
  if (level === 'warning') return 'warn';
  return '';
}

export function ConsolePanel({ logs, engines }: ConsolePanelProps) {
  const [filter, setFilter] = useState<LogFilter>('all');
  const endRef = useRef<HTMLDivElement | null>(null);

  const visible = useMemo(
    () => (filter === 'all' ? logs : logs.filter((l) => l.engine === filter)),
    [logs, filter],
  );

  useEffect(() => {
    if (visible.length > 0) endRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [visible]);

  return (
    <section className="console">
      <div className="console-head">
        <span>console</span>
        <div className="filters">
          {(['all', ...engines] as LogFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              className={filter === f ? 'active' : ''}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
      <div className="console-body">
        {visible.map((log) =>
          log.kind === 'navigation' ? (
            // 페이지 이동/리로드 구분선 — 이후 로그가 어느 화면의 것인지 보여준다
            <div key={log.id} className="log-line nav">
              <span className={`log-engine ${log.engine}`}>{log.engine}</span>
              <span className="log-kind">navigate</span>
              <span className="log-text">→ {log.text}</span>
            </div>
          ) : (
            <div key={log.id} className={`log-line ${levelClass(log.level)}`}>
              <span className={`log-engine ${log.engine}`}>{log.engine}</span>
              <span className="log-kind">{log.kind === 'console' ? log.level : log.kind}</span>
              <span className="log-text">{log.text}</span>
            </div>
          ),
        )}
        <div ref={endRef} />
      </div>
    </section>
  );
}
