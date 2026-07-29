import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // 소스 해석 — 이유는 packages/agent/vitest.config.ts 주석 참조
      '@crosspane/protocol': resolve(import.meta.dirname, '../protocol/src/index.ts'),
    },
  },
});
