import type { EngineName } from './protocol.js';

/**
 * URL 단일 소스 수렴 계획 — 리더 엔진의 URL을 기준으로 어긋난 팔로워를 되돌린다.
 *
 * 원칙:
 * - 우발적 어긋남(클릭 미러링 누락, 일시적 실패)은 자동 수렴으로 제거한다
 * - 같은 목표로 이미 되돌렸는데 다시 어긋난 엔진은 건드리지 않는다 —
 *   그건 진짜 동작 차이(엔진별 리다이렉트 등)이고, 이 툴이 드러내야 할 버그 신호다
 */

/** 리더 우선순위 — 가장 안정적인 엔진 순 */
const LEADER_PRIORITY: readonly EngineName[] = ['chromium', 'webkit', 'firefox'];

export interface UrlSyncPlan {
  engine: EngineName;
  target: string;
}

/** 트레일링 슬래시 차이 등 표기 차이를 흡수한 비교용 정규화 */
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.pathname === '/') parsed.pathname = '';
    return parsed.href;
  } catch {
    return url;
  }
}

export function pickLeader(engines: Iterable<EngineName>): EngineName | undefined {
  const present = new Set(engines);
  return LEADER_PRIORITY.find((engine) => present.has(engine));
}

export function planUrlSync(input: {
  /** 엔진별 마지막 내비게이션 URL */
  urls: ReadonlyMap<EngineName, string>;
  /** 수렴 명령을 보낼 수 있는 엔진 (실행 중 + 브라우저 엔진) */
  syncable: readonly EngineName[];
  /** 엔진별로 이미 시도한 수렴 목표 (같은 목표 재시도 방지) */
  attempted: ReadonlyMap<EngineName, string>;
}): UrlSyncPlan[] {
  const leader = pickLeader(input.syncable);
  if (!leader) return [];
  const target = input.urls.get(leader);
  if (!target) return [];
  const normalizedTarget = normalizeUrl(target);

  const plans: UrlSyncPlan[] = [];
  for (const engine of input.syncable) {
    if (engine === leader) continue;
    const current = input.urls.get(engine);
    if (current === undefined) continue; // 아직 내비게이션 전 — 판단 불가
    if (normalizeUrl(current) === normalizedTarget) continue;
    if (input.attempted.get(engine) === normalizedTarget) continue; // 실차이로 보존
    plans.push({ engine, target });
  }
  return plans;
}
