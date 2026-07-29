import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import { coverageOptions } from '../../vitest.shared';

export default defineConfig({
  test: {
    coverage: coverageOptions(
      // 래칫 — 현재 달성치 바로 아래. 올릴 때만 조인다
      { statements: 95, lines: 97, functions: 94, branches: 81 },
      [
        // 프로세스 엔트리(조립만) — `pnpm smoke`가 이 경로의 검증 수단이다
        'src/index.ts',
        // 재수출 배럴 — 실행할 것이 없다
        'src/lib.ts',
        'src/protocol.ts',
      ],
    ),
  },
  resolve: {
    alias: {
      // 소스 해석 — 이유는 packages/agent/vitest.config.ts 주석 참조
      '@crosspane/protocol': resolve(import.meta.dirname, '../protocol/src/index.ts'),
    },
  },
});
