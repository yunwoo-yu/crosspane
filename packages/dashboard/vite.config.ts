import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
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
