#!/usr/bin/env node
// 단일 파일 빌드 — 번들러를 못 쓰는 환경(프록시 주입, 키오스크, 사내 정적 페이지)에서
// <script>로 바로 붙일 수 있어야 한다. tsc 산출물은 다중 파일 ESM이라 그대로는 불가.
import { readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

const shared = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  minify: true,
  target: ['es2019'], // 구형 WebView(Android 7~9)까지 커버
  logLevel: 'warning',
};

await build({ ...shared, format: 'esm', outfile: 'dist/crosspane-agent.esm.js' });

// IIFE: window.crosspane.initCrosspane(...) — <script src> 한 줄로 끝나는 형태
await build({
  ...shared,
  format: 'iife',
  globalName: 'crosspane',
  outfile: 'dist/crosspane-agent.global.js',
});

for (const file of ['dist/crosspane-agent.esm.js', 'dist/crosspane-agent.global.js']) {
  const gzip = gzipSync(readFileSync(file)).length;
  console.log(
    `${file}  ${(statSync(file).size / 1024).toFixed(1)}KB raw · ${(gzip / 1024).toFixed(1)}KB gzip`,
  );
}
