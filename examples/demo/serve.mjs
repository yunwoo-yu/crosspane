#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
// 데모 페이지 서버 — 빌드된 에이전트를 그대로 서빙해 실제 브라우저에서 검증한다.
//   node examples/demo/serve.mjs   → http://localhost:7999
import http from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const agentBundle = join(here, '../../packages/agent/dist/crosspane-agent.esm.js');
const replayBundle = join(here, '../../packages/agent-replay/dist/crosspane-agent-replay.esm.js');
const PORT = Number(process.env.PORT ?? 7999);
// 허브 포트를 페이지에 주입한다 — 하드코딩하면 커스텀 포트에서 에이전트가
// 조용히 연결 실패하고 대시보드가 이유 없이 비어 보인다
const HUB_PORT = Number(process.env.CROSSPANE_PORT ?? 7788);
/**
 * 노출된 허브(`--host`)의 접속 토큰. **이것을 넘기지 않으면 `pnpm try:lan`이 조용히
 * 깨진다** — 허브는 토큰을 요구하고 데모의 serverUrl에는 없어서 `/agent`가 401로 거절된다.
 * 문서가 안내하는 폰 테스트 경로가 그 상태로 있었다(실측: 토큰 없이 401, 있으면 연결).
 */
const HUB_TOKEN = process.env.CROSSPANE_HUB_TOKEN ?? '';

const server = http.createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  try {
    if (path === '/' || path.startsWith('/screen-')) {
      const html = await readFile(join(here, 'index.html'), 'utf-8');
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(
        html
          .replace('__CROSSPANE_HUB_PORT__', String(HUB_PORT))
          .replace('__CROSSPANE_HUB_QUERY__', HUB_TOKEN === '' ? '' : `/?t=${HUB_TOKEN}`),
      );
      return;
    }
    // 단일 파일 번들 — 번들러 없이 <script type="module">로 붙는 실제 사용자 경로
    if (path === '/agent.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end(await readFile(agentBundle));
      return;
    }
    if (path === '/agent-replay.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end(await readFile(replayBundle));
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

// 포트 충돌을 스택 트레이스로 던지지 않는다 — 원인과 조치를 한 줄로 알린다
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `demo page: port ${PORT} is already in use — another demo server is probably running.\n` +
        '  Stop it, or set PORT to something else (PORT=8099 pnpm demo).',
    );
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(`demo page  → http://localhost:${PORT}  (hub: :${HUB_PORT})`);
  console.log('hub        → run `pnpm hub` in another terminal (or `pnpm try` for both)');
});
