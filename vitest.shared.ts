import type { ViteUserConfig } from 'vitest/config';

type Coverage = NonNullable<NonNullable<ViteUserConfig['test']>['coverage']>;
type Thresholds = Partial<Record<'lines' | 'functions' | 'branches' | 'statements', number>>;

/**
 * 패키지 공용 커버리지 설정 — 5개 vitest 설정이 같은 기준으로 재는 단일 소스.
 *
 * 커버리지는 품질이 아니라 **손대지 않은 경로를 드러내는 도구**로 쓴다.
 * 숫자를 올리기 위한 테스트는 쓰지 말 것 — 임계값은 회귀 방지 래칫이며,
 * 올릴 때만 조인다(내리려면 왜 내리는지 근거를 커밋 메시지에 남길 것).
 *
 * **제외는 공통으로 두지 않는다.** `src/index.ts`는 cli에서는 프로세스 엔트리지만
 * agent에서는 본체 로직이다 — 한 번 공통으로 뺐다가 에이전트 커버리지가 통째로
 * 사라졌다. 무엇을 왜 빼는지는 각 패키지 설정에서 밝힐 것.
 */
export function coverageOptions(thresholds: Thresholds, exclude: string[] = []): Coverage {
  return {
    provider: 'v8',
    reporter: ['text-summary', 'text'],
    include: ['src/**/*.ts', 'src/**/*.tsx'],
    exclude: ['src/**/*.d.ts', ...exclude],
    thresholds,
  };
}
