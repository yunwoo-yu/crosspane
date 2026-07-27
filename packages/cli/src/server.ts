import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { ClientMessage, EngineName, HelloMessage, ServerMessage } from './protocol.js';
import type { EngineSession } from './session.js';
import { defaultDashboardDir, serveStatic } from './static.js';

export interface AppServer {
  broadcast(msg: ServerMessage): void;
  close(): void;
}

export interface ServerOptions {
  port: number;
  hello: () => HelloMessage;
  sessions: ReadonlyMap<EngineName, EngineSession>;
}

function applyInput(session: EngineSession, msg: ClientMessage): Promise<void> {
  switch (msg.type) {
    case 'click':
      return session.click(msg.x, msg.y);
    case 'scroll':
      return session.scroll(msg.deltaY);
    case 'keypress':
      return session.keypress(msg.key);
    case 'reload':
      return session.reload();
    case 'navigate':
      return session.navigate(msg.url);
  }
}

async function dispatch(
  sessions: ReadonlyMap<EngineName, EngineSession>,
  msg: ClientMessage,
): Promise<void> {
  await Promise.allSettled([...sessions.values()].map((session) => applyInput(session, msg)));
}

export function startServer(opts: ServerOptions): Promise<AppServer> {
  const dashboardDir = defaultDashboardDir();

  const server = http.createServer((req, res) => {
    void serveStatic(dashboardDir, req, res);
  });

  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify(opts.hello()));
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as ClientMessage;
        void dispatch(opts.sessions, msg);
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
