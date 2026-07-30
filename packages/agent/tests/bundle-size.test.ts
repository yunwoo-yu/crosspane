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
 */
const BUDGET_GZIP_KB = 4.5;

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
