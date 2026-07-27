import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // 프로토콜 단일 소스: cli의 TS 소스를 직접 번들 (수동 미러 제거)
      'crosspane/protocol': resolve(__dirname, '../cli/src/protocol.ts'),
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
  },
});
