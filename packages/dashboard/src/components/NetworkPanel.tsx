import { useMemo, useState } from 'react';
import { toDisplayPath } from '../log-utils';
import { groupNetworkRows, statusTone } from '../network-utils';
import type { EngineName, NetworkEntry } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';

interface NetworkPanelProps {
  entries: NetworkEntry[];
  engines: EngineName[];
}

const TONE_CLASS = {
  ok: 'text-emerald-400',
  redirect: 'text-fg-muted',
  error: 'font-semibold text-danger',
} as const;

/**
 * 엔진별 네트워크 비교 패널 — 같은 요청(method+url)을 한 행으로 묶어
 * "iOS(WebKit)만 401" 같은 엔진 간 차이를 자동으로 드러낸다.
 */
export function NetworkPanel({ entries, engines }: NetworkPanelProps) {
  const [xhrOnly, setXhrOnly] = useState(true);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [search, setSearch] = useState('');

  // 실제 수집된 엔진만 칼럼으로 (실기기 pane은 네트워크 훅이 없다)
  const columns = useMemo(() => {
    const seen = new Set(entries.map((entry) => entry.engine));
    return engines.filter((engine) => seen.has(engine));
  }, [entries, engines]);

  const rows = useMemo(
    () => groupNetworkRows(entries, { xhrOnly, errorsOnly, search }),
    [entries, xhrOnly, errorsOnly, search],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-line border-b px-3 py-1.5">
        <Input
          className="max-w-56"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="URL 검색"
          aria-label="search requests"
        />
        <Button
          variant="ghost"
          size="icon"
          className={xhrOnly ? 'border-accent text-fg' : ''}
          onClick={() => setXhrOnly((v) => !v)}
          title="정적 리소스를 숨기고 XHR/fetch만 표시"
        >
          XHR/fetch
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={errorsOnly ? 'border-accent text-fg' : ''}
          onClick={() => setErrorsOnly((v) => !v)}
          title="4xx/5xx가 있는 요청만"
        >
          errors
        </Button>
        <span className="ml-auto text-[11px] text-fg-muted">{rows.length} requests</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto font-mono text-xs">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-panel text-left text-[10px] text-fg-muted uppercase tracking-wider">
            <tr>
              <th className="px-3 py-1 font-medium">method</th>
              <th className="py-1 pr-3 font-medium">url</th>
              {columns.map((engine) => (
                <th key={engine} className="py-1 pr-3 font-medium">
                  {engine}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.key}
                className={
                  row.statusMismatch
                    ? 'bg-warn/10 text-warn' // 엔진 간 상태가 다른 행 — 이 툴이 존재하는 이유
                    : 'text-fg'
                }
              >
                <td className="px-3 py-0.5 text-fg-muted">{row.method}</td>
                <td className="max-w-96 truncate py-0.5 pr-3" title={row.url}>
                  {toDisplayPath(row.url)}
                </td>
                {columns.map((engine) => {
                  const cell = row.perEngine[engine];
                  return (
                    <td key={engine} className="whitespace-nowrap py-0.5 pr-3">
                      {cell ? (
                        <>
                          <span className={TONE_CLASS[statusTone(cell.status)]}>{cell.status}</span>
                          {cell.durationMs >= 0 && (
                            <span className="ml-1.5 text-fg-muted">{cell.durationMs}ms</span>
                          )}
                        </>
                      ) : (
                        <span className="text-fg-muted">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="px-3 py-4 text-fg-muted">요청 없음 — 페이지를 조작해보세요</div>
        )}
      </div>
    </div>
  );
}
