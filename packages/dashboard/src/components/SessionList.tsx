import { PLATFORM_LABEL } from '../constants';
import { toDisplayPath } from '../log-utils';
import type { SessionMeta, SessionState } from '../types';
import { Badge } from './ui/badge';

interface SessionListProps {
  sessions: SessionMeta[];
  states: Record<string, SessionState>;
  selectedId: string | null;
  onSelect: (sessionId: string | null) => void;
}

/** 접속한 세션 목록 — 라이브/종료 상태와 에러 배지를 한눈에 */
export function SessionList({ sessions, states, selectedId, onSelect }: SessionListProps) {
  if (sessions.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-line border-b px-4 py-2">
      <button
        type="button"
        className={`rounded px-2 py-1 text-xs ${selectedId === null ? 'bg-accent/20 text-fg' : 'text-fg-muted'}`}
        onClick={() => onSelect(null)}
      >
        All sessions
      </button>
      {sessions.map((session) => {
        const state = states[session.id];
        return (
          <button
            key={session.id}
            type="button"
            title={session.userAgent}
            className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs ${
              selectedId === session.id ? 'bg-accent/20 text-fg' : 'text-fg-muted'
            }`}
            onClick={() => onSelect(session.id)}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${state?.live ? 'bg-emerald-400' : 'bg-fg-muted'}`}
              role="img"
              aria-label={state?.live ? 'live' : 'ended'}
            />
            <span className="font-medium">{session.label}</span>
            <span className="text-fg-muted">
              {PLATFORM_LABEL[session.platform ?? 'browser'] ?? session.platform}
            </span>
            {state?.currentUrl && (
              <span className="max-w-40 truncate text-fg-muted">
                {toDisplayPath(state.currentUrl)}
              </span>
            )}
            {state?.errorCount ? <Badge variant="destructive">{state.errorCount}</Badge> : null}
          </button>
        );
      })}
    </div>
  );
}
