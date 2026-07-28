import type { EngineName } from './protocol.js';

/**
 * URL 단일 소스 수렴 계획 — 리더 엔진의 URL을 기준으로 어긋난 팔로워를 되돌린다.
 *
 * 원칙: 어긋남은 이유 불문 리더로 수렴한다 (사용자 요구 — 일치가 최우선).
 * 단 같은 목표로의 재시도는 쿨다운을 둔다 — 엔진별 리다이렉트(로그인 등)와
 * 수렴이 무한 루프로 싸우지 않게 하되, 계속 되돌리기는 유지한다.
 */

export const SYNC_RETRY_COOLDOWN_MS = 3_000;

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
  /** 엔진별 마지막 수렴 시도 (같은 목표는 쿨다운 후 재시도) */
  attempted: ReadonlyMap<EngineName, { target: string; ts: number }>;
  now: number;
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
    const last = input.attempted.get(engine);
    if (last && last.target === normalizedTarget && input.now - last.ts < SYNC_RETRY_COOLDOWN_MS) {
      continue; // 쿨다운 — 곧 재시도된다
    }
    plans.push({ engine, target });
  }
  return plans;
}

/**
 * 리더와 어긋난 팔로워가 남아 있는가 — 쿨다운으로 이번 계획에서 빠졌더라도
 * 수렴 재시도를 예약해야 하는지 판단한다 (planUrlSync와 같은 리더/정규화 규칙).
 */
export function hasDivergedUrls(
  urls: ReadonlyMap<EngineName, string>,
  syncable: readonly EngineName[],
): boolean {
  const leader = pickLeader(syncable);
  if (!leader) return false;
  const leaderUrl = urls.get(leader);
  if (leaderUrl === undefined) return false;
  const normalizedTarget = normalizeUrl(leaderUrl);
  return syncable.some((engine) => {
    const current = urls.get(engine);
    return current !== undefined && normalizeUrl(current) !== normalizedTarget;
  });
}
