// 대시보드 빌드를 cli 패키지의 dist/public으로 복사한다.
// npm 배포물은 모노레포 밖에서 실행되므로 정적 파일을 패키지 안에 번들해야 한다.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dashboardDist = resolve(here, '../../dashboard/dist');
const bundleTarget = resolve(here, '../dist/public');

if (!existsSync(dashboardDist)) {
  console.error('dashboard build not found — run: pnpm --filter crosspane-dashboard build');
  process.exit(1);
}

rmSync(bundleTarget, { recursive: true, force: true });
cpSync(dashboardDist, bundleTarget, { recursive: true });
console.log(`bundled dashboard → ${bundleTarget}`);
