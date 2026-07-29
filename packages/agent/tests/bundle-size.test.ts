import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

/**
 * 번들 예산 — 이 SDK는 사용자 앱 번들에 들어가므로 크기가 곧 채택 장벽이다.
 * 상한을 넘으면 의존성이 새로 들어왔거나 의도치 않게 커진 것이다 (rules/agent-sdk.md).
 * 빌드 전이면 건너뛴다 (`pnpm build` 후 유효).
 */
const BUDGET_GZIP_KB = 4;

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
