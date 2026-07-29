#!/usr/bin/env node
// 단일 파일 빌드 — 코어 에이전트와 같은 이유(번들러 없는 환경).
// 코어(@crosspane/agent)는 external로 둔다: 페이지가 이미 로드한 인스턴스를
// 써야 세션이 하나로 유지된다 (번들에 포함하면 두 번째 에이전트가 생긴다).
import { readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  minify: true,
  format: 'esm',
  target: ['es2019'],
  external: ['@crosspane/agent'],
  outfile: 'dist/crosspane-agent-replay.esm.js',
  logLevel: 'warning',
});

const file = 'dist/crosspane-agent-replay.esm.js';
const gzip = gzipSync(readFileSync(file)).length;
console.log(
  `${file}  ${(statSync(file).size / 1024).toFixed(1)}KB raw · ${(gzip / 1024).toFixed(1)}KB gzip`,
);
