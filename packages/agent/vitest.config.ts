import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import { coverageOptions } from '../../vitest.shared';

export default defineConfig({
  test: {
    environment: 'jsdom',
    // 이 패키지는 사용자 앱 번들에 들어간다 — 커버리지 기준도 가장 높게 잡는다.
    // src/index.ts는 여기서는 본체(initCrosspane)이므로 제외하지 않는다
    coverage: coverageOptions({ statements: 95, lines: 98, functions: 88, branches: 74 }),
  },
  resolve: {
    alias: {
      // 워크스페이스 의존은 소스로 해석한다 — dist를 가리키면 테스트가 빌드
      // 순서에 묶이고, CI(test가 build보다 먼저)에서 해석 실패한다
      '@crosspane/protocol': resolve(import.meta.dirname, '../protocol/src/index.ts'),
    },
  },
});
