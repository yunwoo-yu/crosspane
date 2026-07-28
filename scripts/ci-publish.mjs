// CI 전용 배포 스크립트 — `changeset publish`를 쓰지 않는 이유:
// changesets는 pnpm 워크스페이스를 감지하면 `pnpm publish --no-git-checks`를 쓰고,
// pnpm은 OIDC 신뢰 배포 시 npm CLI에 위임하며 이 플래그를 전달하는데,
// 최신 npm이 미지 플래그를 EUNKNOWNCONFIG 에러로 거부한다 (0.6.2 배포 3연속 실패).
// npm publish(OIDC+provenance 네이티브 경로)를 직접 실행하고 태그만 changesets에 맡긴다.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('packages/cli/package.json', 'utf-8'));
let published = '';
try {
  published = execSync(`npm view ${pkg.name} version`, { encoding: 'utf-8' }).trim();
} catch {
  // 미배포 패키지면 view가 실패한다 — 첫 배포로 진행
}

if (published === pkg.version) {
  console.log(`${pkg.name}@${pkg.version} is already on npm — skipping publish`);
} else {
  execSync('npm publish', { cwd: 'packages/cli', stdio: 'inherit' });
}
// "New tag:" 출력이 changesets 액션의 GitHub Release 생성 트리거다
execSync('npx changeset tag', { stdio: 'inherit' });
