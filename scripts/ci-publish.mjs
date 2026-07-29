// CI 전용 배포 스크립트 — `changeset publish`를 쓰지 않는 이유:
// changesets는 pnpm 워크스페이스를 감지하면 `pnpm publish --no-git-checks`를 쓰고,
// pnpm은 OIDC 신뢰 배포 시 npm CLI에 위임하며 이 플래그를 전달하는데,
// 최신 npm이 미지 플래그를 EUNKNOWNCONFIG 에러로 거부한다 (0.6.2 배포 3연속 실패).
// npm publish(OIDC+provenance 네이티브 경로)를 직접 실행하고 태그만 changesets에 맡긴다.
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** private이 아닌 워크스페이스 패키지 전부 — 새 패키지를 추가해도 자동 포함된다 */
function publishablePackages() {
  return readdirSync('packages', { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join('packages', entry.name))
    .flatMap((dir) => {
      try {
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
        return pkg.private ? [] : [{ dir, name: pkg.name, version: pkg.version }];
      } catch {
        return []; // package.json이 없는 디렉터리
      }
    });
}

const failures = [];
for (const pkg of publishablePackages()) {
  let published = '';
  try {
    published = execSync(`npm view ${pkg.name} version`, { encoding: 'utf-8', stdio: 'pipe' })
      .toString()
      .trim();
  } catch {
    // 미배포 패키지면 view가 실패한다 — 첫 배포로 진행
  }

  if (published === pkg.version) {
    console.log(`${pkg.name}@${pkg.version} is already on npm — skipping`);
    continue;
  }
  const isFirstPublish = published === '';
  try {
    console.log(
      `publishing ${pkg.name}@${pkg.version}${isFirstPublish ? ' (first publish)' : ''}…`,
    );
    execSync('npm publish', { cwd: pkg.dir, stdio: 'inherit' });
  } catch (err) {
    // 한 패키지의 실패가 나머지 배포를 막지 않게 하되, 종료 코드로는 알린다.
    // 스코프 패키지의 "첫" 배포는 OIDC 신뢰 퍼블리셔를 미리 등록할 수 없어
    // (패키지가 아직 없으므로) 수동 1회 배포가 필요하다 — 그 경우 여기서 걸린다
    failures.push(
      isFirstPublish
        ? `${pkg.name}@${pkg.version}: first publish cannot use OIDC — a trusted publisher ` +
            `can only be registered on a package that already exists. Run ` +
            `\`cd ${pkg.dir} && npm publish --access public\` once, then register it (CONTRIBUTING.md).`
        : `${pkg.name}@${pkg.version}: ${err instanceof Error ? err.message : err}`,
    );
  }
}

// "New tag:" 출력이 changesets 액션의 GitHub Release 생성 트리거다
execSync('npx changeset tag', { stdio: 'inherit' });

if (failures.length > 0) {
  console.error(`\nfailed to publish ${failures.length} package(s):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
