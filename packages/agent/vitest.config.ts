import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'jsdom' },
  resolve: {
    alias: {
      // 워크스페이스 의존은 소스로 해석한다 — dist를 가리키면 테스트가 빌드
      // 순서에 묶이고, CI(test가 build보다 먼저)에서 해석 실패한다
      '@crosspane/protocol': resolve(import.meta.dirname, '../protocol/src/index.ts'),
    },
  },
});
