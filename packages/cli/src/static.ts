import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
};

export function defaultDashboardDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // packaged: dist/public — monorepo dev: ../../dashboard/dist
  return process.env.CROSSPANE_DASHBOARD_DIR ?? path.resolve(here, '../../dashboard/dist');
}

export async function serveStatic(
  rootDir: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const urlPath = (req.url ?? '/').split('?')[0];
  const rel = urlPath === '/' ? 'index.html' : urlPath.slice(1);
  const file = path.join(rootDir, path.normalize(rel));
  if (!file.startsWith(rootDir)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
    });
    res.end(body);
  } catch {
    // SPA fallback
    try {
      const index = await readFile(path.join(rootDir, 'index.html'));
      res.writeHead(200, { 'content-type': MIME['.html'] }).end(index);
    } catch {
      res
        .writeHead(404)
        .end('dashboard build not found — run: pnpm --filter crosspane-dashboard build');
    }
  }
}
