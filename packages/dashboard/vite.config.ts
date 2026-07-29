import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { coverageOptions } from '../../vitest.shared';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // 프로토콜 단일 소스: cli의 TS 소스를 직접 번들 (수동 미러 제거)
      '@crosspane/protocol': resolve(__dirname, '../protocol/src/index.ts'),
    },
  },
  server: {
    proxy: {
      // 대시보드 단독 개발(vite dev) 시 CLI 서버로 WebSocket을 넘긴다
      '/ws': { target: 'ws://localhost:7788', ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    // testing-library의 렌더 자동 정리(auto-cleanup)는 전역 afterEach가 있어야 동작한다
    globals: true,
    coverage: coverageOptions(
      // 패널 컴포넌트는 아직 유닛 테스트가 없다(실브라우저로 확인해 왔다).
      // 이 수치를 올리려면 패널을 덮어야 한다 — 제외로 숨기지 말 것
      { statements: 72, lines: 72, functions: 56, branches: 59 },
      [
        // 앱 엔트리·조립 — 실브라우저 확인이 검증 수단이다
        'src/main.tsx',
        'src/App.tsx',
        // shadcn 계열 프리미티브 — 프로젝트 로직이 아니라 스타일 래퍼다
        'src/components/ui/**',
      ],
    ),
  },
});
