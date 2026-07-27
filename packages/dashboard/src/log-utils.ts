import type { EngineName, EngineState, LogEntry } from './types';

/**
 * 마지막 내비게이션(페이지 이동/리로드) 이후의 에러만 센다.
 * 이전 페이지에서 난 에러가 배지에 계속 남아 있으면 현재 화면 상태와 무관한
 * 노이즈가 되기 때문이다.
 */
export function countErrorsSinceLastNavigation(logs: LogEntry[], engine: EngineName): number {
  let count = 0;
  for (const log of logs) {
    if (log.engine !== engine) continue;
    if (log.kind === 'navigation') count = 0;
    else if (log.level === 'error') count += 1;
  }
  return count;
}

/** 엔진들이 서로 다른 URL에 있으면(상태 어긋남) true */
export function detectUrlDesync(engineStates: Partial<Record<EngineName, EngineState>>): boolean {
  const urls = Object.values(engineStates)
    .map((state) => state?.currentUrl)
    .filter((url): url is string => Boolean(url));
  return urls.length > 1 && new Set(urls).size > 1;
}

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

/** URL 바 입력을 이동 가능한 URL로 정규화한다 (":3000" 축약, 스킴 보정) */
export function normalizeUrlInput(input: string): string {
  const trimmed = input.trim();
  if (/^:?\d+$/.test(trimmed)) return `http://localhost:${trimmed.replace(':', '')}`;
  if (!/^https?:\/\//.test(trimmed)) return `http://${trimmed}`;
  return trimmed;
}

export type ConsoleLevelFilter = 'all' | 'log' | 'warning' | 'error';

/** 콘솔 레벨/검색 필터 — 내비게이션 구분선은 맥락 유지를 위해 항상 남긴다 */
export function filterLogs(
  logs: LogEntry[],
  level: ConsoleLevelFilter,
  search: string,
): LogEntry[] {
  const query = search.trim().toLowerCase();
  return logs.filter((log) => {
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
