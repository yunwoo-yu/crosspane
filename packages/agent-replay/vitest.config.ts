import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import { coverageOptions } from '../../vitest.shared';

export default defineConfig({
  test: {
    environment: 'jsdom',
    coverage: coverageOptions({ statements: 100, lines: 100, functions: 75, branches: 100 }),
  },
  resolve: {
    alias: {
      // 소스 해석 — 이유는 packages/agent/vitest.config.ts 주석 참조
      '@crosspane/protocol': resolve(import.meta.dirname, '../protocol/src/index.ts'),
      '@crosspane/agent': resolve(import.meta.dirname, '../agent/src/index.ts'),
    },
  },
});
