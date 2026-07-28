import { countErrorsSinceLastNavigation, detectUrlDesync } from './log-utils';
import type { EngineName, EngineState, HelloEvent, LogEntry } from './types';

export type EngineStates = Partial<Record<EngineName, EngineState>>;

/** pane은 실행 중(starting/ready/error)인 엔진만 — 중지된 엔진은 그리드에서 빠진다 */
export function computeActiveEngines(
  engineNames: readonly EngineName[],
  engineStates: EngineStates,
): EngineName[] {
  return engineNames.filter((engine) => (engineStates[engine]?.status ?? 'stopped') !== 'stopped');
}

/** 세션이 확정한 값(셸 성공 시 ios-sim 인터랙티브) > hello의 초기 가정 */
export function isViewOnlyEngine(
  engine: EngineName,
  engineStates: EngineStates,
  helloViewOnly: readonly EngineName[],
): boolean {
  return engineStates[engine]?.viewOnly ?? helloViewOnly.includes(engine);
}

/**
 * URL 어긋남 감지 대상과 재동기화 목표 URL.
 * view-only 엔진은 클릭을 따라가지 못해 뒤처지는 게 정상이고 중지된 엔진의 URL은
 * 과거 값이다 — 판단은 실행 중 + 미러링 엔진끼리만 한다.
 */
export function computeUrlSync(
  engineStates: EngineStates,
  activeEngines: readonly EngineName[],
  helloViewOnly: readonly EngineName[],
): { urlDesynced: boolean; syncTargetUrl: string | undefined } {
  const mirrored = activeEngines.filter(
    (engine) => !isViewOnlyEngine(engine, engineStates, helloViewOnly),
  );
  const mirroredStates = Object.fromEntries(
    mirrored.map((engine) => [engine, engineStates[engine]]),
  ) as EngineStates;
  return {
    urlDesynced: detectUrlDesync(mirroredStates),
    syncTargetUrl: mirrored.map((engine) => engineStates[engine]?.currentUrl).find(Boolean),
  };
}

/** pane 배지와 하단 탭 배지가 같은 기준(엔진별 마지막 내비게이션 이후)을 쓰도록 한 번에 계산 */
export function computeErrorCounts(
  logs: readonly LogEntry[],
  engineNames: readonly EngineName[],
): Map<EngineName, number> {
  const counts = new Map<EngineName, number>();
  for (const engine of engineNames) {
    counts.set(engine, countErrorsSinceLastNavigation(logs as LogEntry[], engine));
  }
  return counts;
}

export interface SessionView {
  engineNames: EngineName[];
  activeEngines: EngineName[];
  isViewOnly: (engine: EngineName) => boolean;
  urlDesynced: boolean;
  syncTargetUrl: string | undefined;
  errorCounts: Map<EngineName, number>;
  errorLogCount: number;
  paneViewport: { width: number; height: number };
}

/** hello + engineStates + logs로부터의 순수 파생 — App은 이 뷰만 소비한다 */
export function computeSessionView(
  hello: HelloEvent | null,
  engineStates: EngineStates,
  logs: readonly LogEntry[],
): SessionView {
  const engineNames = hello?.engines ?? [];
  const helloViewOnly = hello?.viewOnlyEngines ?? [];
  const activeEngines = computeActiveEngines(engineNames, engineStates);
  const errorCounts = computeErrorCounts(logs, engineNames);
  return {
    engineNames,
    activeEngines,
    isViewOnly: (engine) => isViewOnlyEngine(engine, engineStates, helloViewOnly),
    ...computeUrlSync(engineStates, activeEngines, helloViewOnly),
    errorCounts,
    errorLogCount: [...errorCounts.values()].reduce((sum, count) => sum + count, 0),
    paneViewport: hello?.viewport ?? { width: 390, height: 659 },
  };
}
