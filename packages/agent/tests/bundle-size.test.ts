import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

/**
 * 번들 예산 — 이 SDK는 사용자 앱 번들에 들어가므로 크기가 곧 채택 장벽이다.
 * 상한을 넘으면 의존성이 새로 들어왔거나 의도치 않게 커진 것이다 (rules/agent-sdk.md).
 * 빌드 전이면 건너뛴다 (`pnpm build` 후 유효).
 *
 * 4 → 4.5KB로 올린 이유 (무설정 주소 해석 도입, `src/endpoint.ts`):
 * 측정값은 esm 3.85KB / iife 4.04KB였다. **npm 소비자가 받는 esm은 여전히 4KB 아래**이고,
 * 넘긴 것은 iife(script 태그)뿐이다. 초과분의 정체는 번들러별 env 변수 이름 4개인데
 * (VITE_/NEXT_PUBLIC_/PUBLIC_/REACT_APP_), 2개로 줄이면 3.99KB로 들어간다 —
 * 즉 41바이트를 아끼려고 CRA·Astro·SvelteKit 지원을 버리는 선택이었다. 그쪽이 손해다.
 * 4는 측정으로 얻은 한계가 아니라 반올림한 숫자였다. 이 상한은 여전히 래칫이다 —
 * 내리는 것은 언제든 환영, 올리려면 여기에 같은 수준의 근거를 남길 것.
 *
 * 4.5 → 5.5KB로 올린 이유 (리소스 타이밍 보강 + 상호작용 + 렌더링 지표):
 * 측정값은 esm 4.8KB / iife 5.0KB다. 초과분이 사는 곳은 세 가지이고, 셋 다 이 제품이
 * 존재하는 이유에 직결한다 —
 *   1. 리소스 타이밍 보강: 이것이 없을 때 한 페이지의 요청 9건 중 **1건만** 보였다.
 *      사용자에게는 "요청이 안 나갔다"로 읽히던 상태다
 *   2. 상호작용: 개발자도구가 없는 웹뷰에서는 재현 절차를 물어볼 수조차 없다.
 *      "무엇을 눌렀더니"가 없으면 로그는 원인 없는 결과의 나열이다
 *   3. 렌더링 지표: "왜 느리지"는 개발자도구 없이 손도 못 대던 질문이다
 * 어느 것도 편의 라이브러리가 아니라 관측 자체이고, 셋 다 브라우저가 이미 가진 것을
 * 읽을 뿐이라 의존성은 여전히 0이다. 비교 대상(Sentry 브라우저 SDK ~20KB+, LogRocket은
 * 그보다 크다) 대비 5KB는 여전히 채택 장벽이 아니다.
 * **다음에 또 올리려면 옵셔널 패키지 분리를 먼저 검토할 것** — `@crosspane/agent-replay`가
 * 그 선례다(코어의 20배라 분리했다). 무한정 올리는 길로 쓰지 말 것.
 */
const BUDGET_GZIP_KB = 5.5;

describe('bundle size', () => {
  const bundles = ['dist/crosspane-agent.esm.js', 'dist/crosspane-agent.global.js'];

  for (const relative of bundles) {
    it(`${relative}는 gzip ${BUDGET_GZIP_KB}KB 예산 안에 든다`, () => {
      const file = join(import.meta.dirname, '..', relative);
      if (!existsSync(file)) {
        expect(statSync(join(import.meta.dirname, '..')).isDirectory()).toBe(true);
        return; // 미빌드 상태 — CI는 build 후 test를 돌린다
      }
      const gzipKb = gzipSync(readFileSync(file)).length / 1024;
      expect(gzipKb).toBeLessThan(BUDGET_GZIP_KB);
    });
  }
});
