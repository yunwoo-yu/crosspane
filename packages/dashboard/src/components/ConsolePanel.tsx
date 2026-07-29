import { useEffect, useMemo, useRef, useState } from 'react';
import { type ConsoleLevelFilter, filterLogs, formatLogTime, isNearBottom } from '../log-utils';
import type { LogEntry, SessionMeta } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';

interface ConsolePanelProps {
  logs: LogEntry[];
  sessions: SessionMeta[];
}

type SessionFilter = string | 'all';

const LEVELS: ConsoleLevelFilter[] = ['all', 'log', 'warning', 'error'];

function levelClass(level: string): string {
  if (level === 'error') return 'error';
  if (level === 'warning') return 'warn';
  return '';
}

export function ConsolePanel({ logs, sessions }: ConsolePanelProps) {
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>('all');
  const [levelFilter, setLevelFilter] = useState<ConsoleLevelFilter>('all');
  const [search, setSearch] = useState('');
  // 스마트 오토스크롤: 바닥 근처에 있을 때만 새 로그를 따라간다
  const [follow, setFollow] = useState(true);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const visible = useMemo(
    () => filterLogs(logs, { sessionId: sessionFilter, level: levelFilter, search }),
    [logs, sessionFilter, levelFilter, search],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies(visible): 새 로그가 렌더된 뒤 바닥으로 스크롤해야 하므로 visible 변경이 트리거
  useEffect(() => {
    const body = bodyRef.current;
    if (follow && body) body.scrollTop = body.scrollHeight;
  }, [visible, follow]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="console-head">
        <div className="filters">
          <Button
            variant={sessionFilter === 'all' ? 'active' : 'ghost'}
            size="icon"
            onClick={() => setSessionFilter('all')}
          >
            all
          </Button>
          {sessions.map((session) => (
            <Button
              key={session.id}
              variant={sessionFilter === session.id ? 'active' : 'ghost'}
              size="icon"
              onClick={() => setSessionFilter(session.id)}
              title={session.userAgent}
            >
              {session.label}
            </Button>
          ))}
        </div>
        <span className="h-4 w-px bg-line" />
        <div className="filters">
          {LEVELS.map((level) => (
            <Button
              key={level}
              variant={levelFilter === level ? 'active' : 'ghost'}
              size="icon"
              onClick={() => setLevelFilter(level)}
              title={level === 'warning' ? 'warning and above' : level}
            >
              {level}
            </Button>
          ))}
        </div>
        <Input
          className="max-w-48"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Filter logs"
          aria-label="search logs"
        />
        {!follow && (
          <Button
            variant="warn"
            size="icon"
            className="ml-auto"
            onClick={() => {
              setFollow(true);
              const body = bodyRef.current;
              if (body) body.scrollTop = body.scrollHeight;
            }}
            title="Resume following new logs"
          >
            ↓ Latest
          </Button>
        )}
      </div>
      <div
        className="console-body"
        ref={bodyRef}
        onScroll={(event) => setFollow(isNearBottom(event.currentTarget))}
      >
        {visible.map((log) =>
          log.kind === 'navigation' ? (
            // 페이지 이동/리로드 구분선 — 이후 로그가 어느 화면의 것인지 보여준다
            <div key={log.id} className="log-line nav">
              <span className="log-time">{formatLogTime(log.ts)}</span>
              <span className="log-kind">navigate</span>
              <span className="log-text">→ {log.text}</span>
            </div>
          ) : (
            <div key={log.id} className={`log-line ${levelClass(log.level)}`}>
              <span className="log-time">{formatLogTime(log.ts)}</span>
              <span className="log-kind">{log.kind === 'console' ? log.level : log.kind}</span>
              {/* 반복 횟수 — 합쳤다는 사실을 밝힌다. 조용히 합치면 몇 번 일어났는지 오도한다 */}
              {log.repeat !== undefined && log.repeat > 1 && (
                <span
                  className="shrink-0 rounded bg-panel px-1 font-semibold text-fg-muted text-xs tabular-nums"
                  title={`${log.repeat} consecutive occurrences`}
                >
                  ×{log.repeat}
                </span>
              )}
              <span className="log-text">{log.text}</span>
              {log.detail && <pre className="log-detail">{log.detail}</pre>}
            </div>
          ),
        )}
      </div>
    </div>
  );
}
