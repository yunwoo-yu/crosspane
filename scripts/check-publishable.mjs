#!/usr/bin/env node
/**
 * 배포 가능한 패키지의 메타데이터 검증 — CI와 배포 직전에 돌린다.
 *
 * 존재 이유: crosspane@0.7.0이 `"@crosspane/protocol": "workspace:*"`를 그대로
 * 담아 배포돼 `npm i crosspane`이 EUNSUPPORTEDPROTOCOL로 완전히 깨졌다.
 * npm publish는 pnpm과 달리 workspace: 프로토콜을 치환하지 못한다.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const problems = [];

for (const entry of readdirSync('packages', { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dir = join('packages', entry.name);
  const manifestPath = join(dir, 'package.json');
  if (!existsSync(manifestPath)) continue;
  const pkg = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  if (pkg.private) continue;

  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [dep, range] of Object.entries(pkg[field] ?? {})) {
      if (typeof range === 'string' && /^(workspace|link|file):/.test(range)) {
        problems.push(`${pkg.name}: ${field}.${dep} = "${range}" — npm publish가 치환하지 못한다`);
      }
    }
  }
  // npm 페이지 품질 + 사용자가 저장소를 찾을 수 있게
  for (const field of ['description', 'license', 'repository']) {
    if (!pkg[field]) problems.push(`${pkg.name}: ${field} 누락`);
  }
  if (!existsSync(join(dir, 'README.md'))) problems.push(`${pkg.name}: README.md 누락`);
  if (!existsSync(join(dir, 'LICENSE'))) problems.push(`${pkg.name}: LICENSE 누락`);
}

if (problems.length > 0) {
  console.error('publishable package check failed:');
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  process.exit(1);
}
console.log('publishable package check passed');
