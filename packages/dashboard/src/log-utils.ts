import type { LogEntry } from './types';

/** 표시용으로 URL에서 path+query만 추출한다. http(s)가 아니면(about:blank 등) 그대로 둔다 */
export function toDisplayPath(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.protocol.startsWith('http')) return url;
    return `${parsed.pathname}${parsed.search}` || '/';
  } catch {
    return url;
  }
}

export type ConsoleLevelFilter = 'all' | 'log' | 'warning' | 'error';

export interface ConsoleFilter {
  level: ConsoleLevelFilter;
  search: string;
  /** 세션 id, 또는 'all' */
  sessionId: string | 'all';
}

/**
 * 콘솔 필터 — 세 축(세션·레벨·검색)을 한곳에서 적용한다.
 * 컴포넌트에 한 축만 인라인하면 그 축만 테스트 밖으로 빠진다
 * (`filterNetworkEntries`와 같은 옵션 객체 모양을 유지할 것).
 *
 * 내비게이션 구분선은 맥락 유지를 위해 레벨·검색에서 항상 살아남는다 —
 * 단, 다른 세션의 것은 남기지 않는다(화면이 섞인다).
 */
export function filterLogs(logs: LogEntry[], filter: ConsoleFilter): LogEntry[] {
  const { level, sessionId } = filter;
  const query = filter.search.trim().toLowerCase();
  return logs.filter((log) => {
    if (sessionId !== 'all' && log.sessionId !== sessionId) return false;
    if (log.kind === 'navigation') return true;
    if (level === 'error' && log.level !== 'error') return false;
    if (level === 'warning' && log.level !== 'warning' && log.level !== 'error') return false;
    if (level === 'log' && (log.level === 'warning' || log.level === 'error')) return false;
    if (query && !log.text.toLowerCase().includes(query)) return false;
    return true;
  });
}

export function formatLogTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * 스마트 오토스크롤 판정: 사용자가 바닥 근처에 있을 때만 따라간다.
 * 과거 로그를 보는 중에 새 로그가 화면을 끌어내리는 것 방지 (데브툴 표준 UX)
 */
export function isNearBottom(
  el: { scrollTop: number; scrollHeight: number; clientHeight: number },
  thresholdPx = 32,
): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < thresholdPx;
}

/**
 * 반복이 이어진 기간을 사람이 읽는 형태로 (1초 미만은 null — 순간적 폭주는 기간이 의미 없다).
 *
 * 이게 없으면 10분간 5초마다 반복된 에러가 첫 시각 한 줄로만 보여서
 * "그때 몇 번 나고 멈췄다"로 읽힌다. 아직 계속되고 있다는 사실이 가장 중요한 단서일 수 있다.
 */
export function formatRepeatSpan(firstTs: number, lastTs: number | undefined): string | null {
  if (lastTs === undefined) return null;
  const ms = lastTs - firstTs;
  if (ms < 1_000) return null;
  const seconds = Math.round(ms / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`;
}
