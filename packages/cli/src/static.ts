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
 * 대시보드 정적 파일 위치.
 * CROSSPANE_DASHBOARD_DIR 환경변수가 있으면 최우선(테스트/커스텀 빌드용),
 * 없으면 모노레포 기준 상대경로(packages/dashboard/dist)를 쓴다.
 * npm 배포 시에는 빌드 단계에서 dist/public으로 복사해 이 경로를 대체할 예정.
 */
export function resolveDashboardDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return process.env.CROSSPANE_DASHBOARD_DIR ?? path.resolve(here, '../../dashboard/dist');
}

export async function serveDashboardFile(
  rootDir: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const urlPath = (req.url ?? '/').split('?')[0];
  const relativePath = urlPath === '/' ? 'index.html' : urlPath.slice(1);
  const filePath = path.join(rootDir, path.normalize(relativePath));
  // 경로 탈출(../) 방어: 해석된 최종 경로가 루트 밖이면 거부
  if (!filePath.startsWith(rootDir)) {
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
