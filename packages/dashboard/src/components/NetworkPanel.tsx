import { Fragment, useMemo, useState } from 'react';
import { MAX_NETWORK_ENTRIES } from '../constants';
import { toDisplayPath } from '../log-utils';
import { filterNetworkEntries, formatDuration, statusTone } from '../network-utils';
import type { NetworkEntry, SessionMeta } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';

interface NetworkPanelProps {
  entries: NetworkEntry[];
  sessions: SessionMeta[];
}

const TONE_CLASS = {
  ok: 'text-emerald-400',
  redirect: 'text-fg-muted',
  error: 'font-semibold text-danger',
} as const;

/** 세션의 네트워크 타임라인 — 실패(status 0)와 4xx/5xx를 눈에 띄게 */
export function NetworkPanel({ entries, sessions }: NetworkPanelProps) {
  const [xhrOnly, setXhrOnly] = useState(true);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const matching = useMemo(
    () => filterNetworkEntries(entries, { xhrOnly, errorsOnly, search }),
    [entries, xhrOnly, errorsOnly, search],
  );
  // 렌더 상한 — 근거는 ConsolePanel의 같은 주석 참조 (캡처 파일에는 상한이 없다)
  const rows =
    matching.length > MAX_NETWORK_ENTRIES ? matching.slice(-MAX_NETWORK_ENTRIES) : matching;
  const hiddenCount = matching.length - rows.length;
  const labelOf = useMemo(() => {
    const map = new Map(sessions.map((session) => [session.id, session.label]));
    return (sessionId: string) => map.get(sessionId) ?? sessionId;
  }, [sessions]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-line border-b px-4 py-2">
        <Input
          className="max-w-56"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Filter URLs"
          aria-label="search requests"
        />
        <Button
          variant={xhrOnly ? 'active' : 'ghost'}
          size="icon"
          onClick={() => setXhrOnly((v) => !v)}
          title="Hide static assets — show XHR/fetch only"
        >
          XHR/fetch
        </Button>
        <Button
          variant={errorsOnly ? 'active' : 'ghost'}
          size="icon"
          onClick={() => setErrorsOnly((v) => !v)}
          title="Only failed requests (network error, 4xx, 5xx)"
        >
          errors
        </Button>
        <span className="ml-auto text-[11px] text-fg-muted">
          {/* 숨긴 건수를 밝힌다 — 조용히 자르면 "이게 전부"로 오도한다 */}
          {hiddenCount > 0
            ? `${rows.length} of ${matching.length.toLocaleString()} requests (filter to narrow)`
            : `${rows.length} requests`}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto font-mono text-xs">
        {rows.length === 0 ? (
          <div className="px-4 py-6 text-fg-muted">No requests yet — interact with the page</div>
        ) : (
          <table className="w-full border-collapse">
            <tbody>
              {rows.map((entry) => (
                <Fragment key={entry.id}>
                  <tr
                    className="cursor-pointer border-line/60 border-b hover:bg-panel"
                    onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                  >
                    <td className="px-3 py-1 text-fg-muted">{entry.method}</td>
                    <td className={`px-2 py-1 ${TONE_CLASS[statusTone(entry.status)]}`}>
                      {entry.status === 0 ? 'ERR' : entry.status}
                    </td>
                    <td className="max-w-0 truncate px-2 py-1" title={entry.url}>
                      {toDisplayPath(entry.url)}
                    </td>
                    <td className="px-2 py-1 text-right text-fg-muted">
                      {formatDuration(entry.durationMs)}
                    </td>
                    <td className="px-3 py-1 text-fg-muted">{labelOf(entry.sessionId)}</td>
                  </tr>
                  {expandedId === entry.id && (
                    <tr className="border-line/60 border-b bg-app/60">
                      <td colSpan={5} className="px-4 py-2">
                        <div className="mb-1 break-all text-fg-muted">{entry.url}</div>
                        {entry.error && <div className="text-danger">{entry.error}</div>}
                        {entry.responseHeaders && (
                          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-fg-muted">
                            {Object.entries(entry.responseHeaders)
                              .map(([key, value]) => `${key}: ${value}`)
                              .join('\n')}
                          </pre>
                        )}
                        {entry.bodyPreview && (
                          <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap">
                            {entry.bodyPreview}
                            {entry.bodyTruncated ? '\n… (truncated)' : ''}
                          </pre>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
