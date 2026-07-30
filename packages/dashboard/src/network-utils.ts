import type { NetworkEntry } from './types';

export interface NetworkFilters {
  /** 정적 리소스를 숨기고 API 호출(xhr/fetch)만 — 기본 켜짐 */
  xhrOnly: boolean;
  errorsOnly: boolean;
  search: string;
  sessionId?: string;
}

const XHR_TYPES = new Set(['xhr', 'fetch']);

/**
 * status 0 = 응답을 못 받음 (네트워크 실패/차단/중단) — 에이전트가 0으로 보낸다.
 *
 * **undefined는 실패가 아니라 "모름"이다.** 리소스 타이밍으로 관측한 요청은 브라우저가
 * 상태 코드를 주지 않는 경우가 있다. 이것을 실패로 세면 "실패한 요청만" 필터가
 * 멀쩡한 이미지로 가득 차서 쓸모가 없어진다
 */
export function isErrorStatus(status: number | undefined): boolean {
  if (status === undefined) return false;
  return status === 0 || status >= 400;
}

export function statusTone(status: number | undefined): 'ok' | 'redirect' | 'unknown' | 'error' {
  if (status === undefined) return 'unknown';
  if (isErrorStatus(status)) return 'error';
  if (status >= 300) return 'redirect';
  return 'ok';
}

/** 필터 적용 (순수 함수) — 최신 요청이 위로 */
export function filterNetworkEntries(
  entries: NetworkEntry[],
  filters: NetworkFilters,
): NetworkEntry[] {
  const query = filters.search.trim().toLowerCase();
  return entries
    .filter((entry) => {
      if (filters.sessionId && entry.sessionId !== filters.sessionId) return false;
      // initiator 미상은 숨기지 않는다 — 에이전트 버전 차이로 비는 경우 대비
      if (filters.xhrOnly && entry.initiator && !XHR_TYPES.has(entry.initiator)) return false;
      if (filters.errorsOnly && !isErrorStatus(entry.status)) return false;
      if (query && !entry.url.toLowerCase().includes(query)) return false;
      return true;
    })
    .sort((a, b) => b.ts - a.ts);
}

export function formatDuration(durationMs: number): string {
  if (durationMs < 0) return '—';
  return durationMs >= 1000 ? `${(durationMs / 1000).toFixed(2)}s` : `${Math.round(durationMs)}ms`;
}
