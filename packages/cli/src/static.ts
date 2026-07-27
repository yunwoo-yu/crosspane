import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
};

/**
 * 대시보드 정적 파일 위치 (우선순위순):
 * 1. CROSSPANE_DASHBOARD_DIR 환경변수 — 테스트/커스텀 빌드용
 * 2. 모노레포 상대경로 — 저장소 개발 흐름 (항상 최신 빌드)
 * 3. dist/public — npm 배포물에 번들된 빌드 (scripts/bundle-dashboard.mjs)
 */
export function resolveDashboardDir(): string {
  if (process.env.CROSSPANE_DASHBOARD_DIR) return process.env.CROSSPANE_DASHBOARD_DIR;
  const here = path.dirname(fileURLToPath(import.meta.url));
  // 모노레포 개발 경로를 번들보다 우선한다 — 대시보드만 다시 빌드했을 때
  // cli 재번들 없이 최신이 서빙되도록. 배포본에는 이 경로가 없어 번들로 폴백된다
  const monorepoDir = path.resolve(here, '../../dashboard/dist');
  if (existsSync(monorepoDir)) return monorepoDir;
  return path.join(here, 'public');
}

export async function serveDashboardFile(
  rootDir: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const urlPath = (req.url ?? '/').split('?')[0];
  const relativePath = urlPath === '/' ? 'index.html' : urlPath.slice(1);
  const resolvedRoot = path.resolve(rootDir);
  const filePath = path.resolve(resolvedRoot, path.normalize(relativePath));
  // 경로 탈출(../) 방어: 구분자까지 포함해 비교해야 형제 디렉터리
  // (예: /root-evil)가 /root의 prefix로 통과하는 것을 막는다. Windows 경로 호환.
  if (filePath !== resolvedRoot && !filePath.startsWith(resolvedRoot + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      'content-type': MIME_TYPES[path.extname(filePath)] ?? 'application/octet-stream',
    });
    res.end(body);
  } catch {
    // 파일이 없으면 SPA 라우팅으로 간주하고 index.html로 폴백
    try {
      const indexHtml = await readFile(path.join(rootDir, 'index.html'));
      res.writeHead(200, { 'content-type': MIME_TYPES['.html'] }).end(indexHtml);
    } catch {
      res
        .writeHead(404)
        .end('dashboard build not found — run: pnpm --filter crosspane-dashboard build');
    }
  }
}
