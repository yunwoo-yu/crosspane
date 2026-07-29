#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
// 데모 페이지 서버 — 빌드된 에이전트를 그대로 서빙해 실제 브라우저에서 검증한다.
//   node examples/demo/serve.mjs   → http://localhost:7999
import http from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const agentDist = join(here, '../../packages/agent/dist');
const PORT = Number(process.env.PORT ?? 7999);

const server = http.createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  try {
    if (path === '/' || path.startsWith('/screen-')) {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(await readFile(join(here, 'index.html')));
      return;
    }
    // 빌드된 에이전트는 다중 파일 ESM이라 디렉터리째 서빙해야 형제 모듈이 해석된다
    if (path.startsWith('/agent/')) {
      const file = path.slice('/agent/'.length);
      if (file.includes('..')) {
        res.writeHead(400).end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end(await readFile(join(agentDist, file)));
      return;
    }
    if (path === '/api/ok') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, items: [1, 2, 3] }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  } catch (err) {
    res.writeHead(500).end(String(err));
  }
});

server.listen(PORT, () => {
  console.log(`demo page  → http://localhost:${PORT}`);
  console.log('hub        → run `crosspane` (or pnpm start) in another terminal');
});
