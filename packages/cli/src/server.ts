import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import type { ClientMessage, EngineName, ServerMessage } from './protocol.js';
import type { EngineSession } from './session.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
};

function defaultDashboardDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // packaged: dist/public — monorepo dev: ../../dashboard/dist
  return process.env.CROSSPANE_DASHBOARD_DIR ?? path.resolve(here, '../../dashboard/dist');
}

export interface AppServer {
  broadcast(msg: ServerMessage): void;
  close(): void;
}

export function startServer(opts: {
  port: number;
  hello: () => Extract<ServerMessage, { type: 'hello' }>;
  sessions: Map<EngineName, EngineSession>;
}): Promise<AppServer> {
  const dashboardDir = defaultDashboardDir();

  const server = http.createServer(async (req, res) => {
    const urlPath = (req.url ?? '/').split('?')[0];
    const rel = urlPath === '/' ? 'index.html' : urlPath.slice(1);
    const file = path.join(dashboardDir, path.normalize(rel));
    if (!file.startsWith(dashboardDir)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      // SPA fallback
      try {
        const index = await readFile(path.join(dashboardDir, 'index.html'));
        res.writeHead(200, { 'content-type': MIME['.html'] }).end(index);
      } catch {
        res.writeHead(404).end('dashboard build not found — run: pnpm --filter crosspane-dashboard build');
      }
    }
  });

  const wss = new WebSocketServer({ server, path: '/ws' });

  const dispatch = async (msg: ClientMessage): Promise<void> => {
    const all = [...opts.sessions.values()];
    await Promise.allSettled(
      all.map((s) => {
        switch (msg.type) {
          case 'click':
            return s.click(msg.x, msg.y);
          case 'scroll':
            return s.scroll(msg.deltaY);
          case 'keypress':
            return s.keypress(msg.key);
          case 'reload':
            return s.reload();
          case 'navigate':
            return s.navigate(msg.url);
        }
      }),
    );
  };

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify(opts.hello()));
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as ClientMessage;
        void dispatch(msg);
      } catch {
        // ignore malformed client messages
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, () => {
      resolve({
        broadcast(msg: ServerMessage) {
          const payload = JSON.stringify(msg);
          for (const client of wss.clients) {
            if (client.readyState === WebSocket.OPEN) client.send(payload);
          }
        },
        close() {
          wss.close();
          server.close();
        },
      });
    });
  });
}
