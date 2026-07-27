import type { EngineName, NetworkEntry } from './types';

export interface NetworkRow {
  key: string;
  method: string;
  url: string;
  /** 엔진별 최신 응답 (같은 요청을 여러 번 하면 마지막 것) */
  perEngine: Partial<
    Record<EngineName, { status: number; durationMs: number; entry: NetworkEntry }>
  >;
  /** 엔진 간 상태코드가 다르면 true — "iOS만 401" 같은 차이를 자동 표시 */
  statusMismatch: boolean;
  lastTs: number;
}

export interface NetworkFilters {
  /** XHR/fetch만 (정적 리소스 노이즈 제거) — 기본 켜짐 */
  xhrOnly: boolean;
  /** 4xx/5xx가 하나라도 있는 행만 */
  errorsOnly: boolean;
  search: string;
}

const XHR_TYPES = new Set(['xhr', 'fetch']);

/** 같은 요청(method+url)을 한 행으로 묶고 엔진별 상태를 나란히 놓는다 */
export function groupNetworkRows(entries: NetworkEntry[], filters: NetworkFilters): NetworkRow[] {
  const search = filters.search.trim().toLowerCase();
  const rows = new Map<string, NetworkRow>();

  for (const entry of entries) {
    if (filters.xhrOnly && !XHR_TYPES.has(entry.resourceType)) continue;
    if (search && !entry.url.toLowerCase().includes(search)) continue;
    const key = `${entry.method} ${entry.url}`;
    let row = rows.get(key);
    if (!row) {
      row = {
        key,
        method: entry.method,
        url: entry.url,
        perEngine: {},
        statusMismatch: false,
        lastTs: entry.ts,
      };
      rows.set(key, row);
    }
    row.perEngine[entry.engine] = { status: entry.status, durationMs: entry.durationMs, entry };
    row.lastTs = Math.max(row.lastTs, entry.ts);
  }

  const result = [...rows.values()];
  for (const row of result) {
    const statuses = new Set(Object.values(row.perEngine).map((cell) => cell.status));
    row.statusMismatch = statuses.size > 1;
  }

  const filtered = filters.errorsOnly
    ? result.filter((row) => Object.values(row.perEngine).some((cell) => cell.status >= 400))
    : result;
  // 최신 요청이 위로
  return filtered.sort((a, b) => b.lastTs - a.lastTs);
}

export function statusTone(status: number): 'ok' | 'redirect' | 'error' {
  if (status >= 400) return 'error';
  if (status >= 300) return 'redirect';
  return 'ok';
}
