import { Fragment, useMemo, useState } from 'react';
import { MAX_NETWORK_ENTRIES } from '../constants';
import { useLocale } from '../hooks/useLocale';
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
  unknown: 'text-fg-muted',
  error: 'font-semibold text-danger',
} as const;

/** 세션의 네트워크 타임라인 — 실패(status 0)와 4xx/5xx를 눈에 띄게 */
export function NetworkPanel({ entries, sessions }: NetworkPanelProps) {
  const { t } = useLocale();
  const [xhrOnly, setXhrOnly] = useState(true);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const matching = useMemo(
    () => filterNetworkEntries(entries, { xhrOnly, errorsOnly, search }),
    [entries, xhrOnly, errorsOnly, search],
  );
  /**
   * 필터가 가린 건수. **비어 있는 화면은 두 가지 뜻을 가질 수 있다** — 요청이 없었거나,
   * 필터가 다 걸렀거나. 둘을 구분해 주지 않으면 사용자는 "이 툴이 기록을 못 했다"로 읽는다.
   * 기본값이 XHR/fetch만 보기이므로 이미지·CSS가 조용히 사라지는 것이 특히 그랬다
   */
  const hiddenByFilter = entries.length - matching.length;
  const clearFilters = () => {
    setXhrOnly(false);
    setErrorsOnly(false);
    setSearch('');
  };
  // 렌더 상한 — 근거는 ConsolePanel의 같은 주석 참조 (캡처 파일에는 상한이 없다).
  // memo 이유도 같다: 매 렌더 새 배열이면 하위 렌더가 불필요하게 갱신된다
  const rows = useMemo(
    () => (matching.length > MAX_NETWORK_ENTRIES ? matching.slice(-MAX_NETWORK_ENTRIES) : matching),
    [matching],
  );
  const hiddenCount = matching.length - rows.length;
  const labelOf = useMemo(() => {
    const map = new Map(sessions.map((session) => [session.id, session.label]));
    return (sessionId: string) => map.get(sessionId) ?? sessionId;
  }, [sessions]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-line border-b px-4 py-2">
        <Input
          className="min-w-0 flex-1 sm:max-w-64"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t.filterUrls}
          aria-label={t.searchRequests}
        />
        <Button
          variant={xhrOnly ? 'active' : 'ghost'}
          size="icon"
          onClick={() => setXhrOnly((v) => !v)}
          title={t.hideStaticAssets}
        >
          {t.xhrFetchOnly}
        </Button>
        <Button
          variant={errorsOnly ? 'active' : 'ghost'}
          size="icon"
          onClick={() => setErrorsOnly((v) => !v)}
          title={t.onlyFailed}
        >
          {t.errorsOnly}
        </Button>
        {/*
          가려진 건수는 **항상** 보인다. 목록에 몇 줄이라도 있으면 사용자는 그것을
          "전부"로 읽는다 — 실측: 요청 9건 중 3건만 보이는데 나머지를 알 길이 없었다
        */}
        {hiddenByFilter > 0 && (
          <Button variant="warn" size="icon" onClick={clearFilters}>
            {t.showHidden(hiddenByFilter)}
          </Button>
        )}
        <span className="ml-auto text-[11px] text-fg-muted">
          {/* 숨긴 건수를 밝힌다 — 조용히 자르면 "이게 전부"로 오도한다 */}
          {t.requestCount(rows.length, hiddenCount > 0 ? matching.length.toLocaleString() : null)}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto font-mono text-xs">
        {rows.length === 0 ? (
          <div className="flex flex-col items-start gap-2 px-4 py-6 text-fg-muted">
            <span>{t.noRequests}</span>
            {hiddenByFilter > 0 && (
              <Button variant="warn" size="icon" onClick={clearFilters}>
                {t.hiddenByFilter(hiddenByFilter)} · {t.showEverything}
              </Button>
            )}
          </div>
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
                      {/* 모르는 것과 실패한 것은 다르게 보여야 한다 */}
                      {entry.status === undefined ? '—' : entry.status === 0 ? 'ERR' : entry.status}
                    </td>
                    <td className="px-1 py-1 text-[10px] text-fg-muted">{entry.initiator}</td>
                    {/* w-full: URL이 남은 폭을 전부 갖는다. 없으면 표가 열을 균등
                        배분해 가장 중요한 열이 `/late-f…`로 잘린다(실측) */}
                    <td className="w-full max-w-0 truncate px-2 py-1" title={entry.url}>
                      {toDisplayPath(entry.url)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1 text-right text-fg-muted">
                      {formatDuration(entry.durationMs)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1 text-fg-muted">
                      {labelOf(entry.sessionId)}
                    </td>
                  </tr>
                  {expandedId === entry.id && (
                    <tr className="border-line/60 border-b bg-app/60">
                      <td colSpan={6} className="px-4 py-2">
                        <div className="mb-1 break-all text-fg-muted">{entry.url}</div>
                        {entry.observed && (
                          // 이 줄만 정보가 적은 이유를 밝힌다 — 안 밝히면 툴의 결함으로 읽힌다
                          <div className="mb-1 text-fg-muted text-[11px]" title={t.observedTitle}>
                            ⓘ {t.observedTitle}
                          </div>
                        )}
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
