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
