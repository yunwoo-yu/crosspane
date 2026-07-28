#!/usr/bin/env node
// E2E 스모크 하네스: 실제 허브 CLI를 기동해 에이전트→허브→대시보드 경로를 검증한다.
// 유닛테스트가 못 잡는 회귀(프로세스 기동, WS 라우팅, 히스토리 재생)를 확인한다.
// 브라우저가 필요 없다 — CI 어디서나 수 초에 끝난다.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

const HUB_PORT = 7997;
const TIMEOUT_MS = 30_000;

const cli = spawn(
  process.execPath,
  ['packages/cli/dist/index.js', '--port', String(HUB_PORT), '--no-open'],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
let cliOutput = '';
cli.stdout.on('data', (chunk) => {
  cliOutput += chunk;
});
cli.stderr.on('data', (chunk) => {
  cliOutput += chunk;
});

const checks = {
  dashboardServed: false, // 정적 대시보드 서빙 (번들 포함 여부)
  sessionJoined: false, // 에이전트 등록 → 대시보드 통지
  eventRelayed: false, // 콘솔 이벤트 중계
  historyReplayed: false, // 늦게 접속한 대시보드가 히스토리를 받는다
  sessionLeft: false, // 에이전트 종료 통지
};

const fail = (reason) => {
  console.error(`SMOKE FAILED: ${reason}`);
  console.error(`checks: ${JSON.stringify(checks)}`);
  console.error(`--- cli output ---\n${cliOutput}`);
  cli.kill('SIGTERM');
  process.exit(1);
};

const timer = setTimeout(() => fail(`timed out after ${TIMEOUT_MS}ms`), TIMEOUT_MS);

/** 허브가 뜰 때까지 대기 */
async function waitForHub() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${HUB_PORT}/`);
      if (response.ok) return await response.text();
    } catch {
      // 아직 기동 전
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  fail('hub did not start');
}

/**
 * 수신 이벤트를 전부 큐에 쌓는다 — 서버는 접속 직후 hello+히스토리를 연달아
 * 보내므로, 리스너를 나중에 붙이면 이미 지나간 이벤트를 놓친다
 */
function connect(path) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${HUB_PORT}${path}`);
    ws.received = [];
    ws.on('message', (raw) => ws.received.push(JSON.parse(String(raw))));
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

/** 조건을 만족하는 이벤트가 (이미 왔거나 곧) 도착할 때까지 대기 */
async function waitFor(ws, predicate, label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const found = ws.received.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  fail(`no ${label}`);
}

const html = await waitForHub();
checks.dashboardServed = html.includes('<div id="root">') || html.includes('<!doctype html');

const dashboard = await connect('/ws');
await waitFor(dashboard, (event) => event.type === 'hello', 'hello');

const agent = await connect('/agent');
const session = {
  id: 's-smoke',
  label: 'smoke session',
  userAgent: 'smoke/1.0',
  url: 'http://localhost/smoke',
  platform: 'browser',
  startedAt: Date.now(),
};
agent.send(JSON.stringify({ type: 'register', session }));
await waitFor(
  dashboard,
  (event) => event.type === 'session-joined' && event.session.id === 's-smoke',
  'session-joined',
);
checks.sessionJoined = true;

agent.send(
  JSON.stringify({
    type: 'events',
    events: [
      { type: 'console', sessionId: 's-smoke', level: 'error', text: 'smoke-log', ts: Date.now() },
      {
        type: 'network',
        sessionId: 's-smoke',
        method: 'GET',
        url: 'http://api/smoke',
        status: 500,
        durationMs: 12,
        initiator: 'fetch',
        ts: Date.now(),
      },
    ],
  }),
);
await waitFor(
  dashboard,
  (event) => event.type === 'console' && event.text === 'smoke-log',
  'console',
);
checks.eventRelayed = true;

// 늦게 접속한 대시보드도 히스토리를 받아야 한다 (사후 분석 경로)
const lateDashboard = await connect('/ws');
const lateHello = await waitFor(lateDashboard, (event) => event.type === 'hello', 'late hello');
if (!lateHello.sessions.some((s) => s.id === 's-smoke')) fail('late hello missing session');
await waitFor(
  lateDashboard,
  (event) => event.type === 'console' && event.text === 'smoke-log',
  'replayed console',
);
checks.historyReplayed = true;

agent.close();
await waitFor(
  dashboard,
  (event) => event.type === 'session-left' && event.sessionId === 's-smoke',
  'session-left',
);
checks.sessionLeft = true;

clearTimeout(timer);
dashboard.close();
lateDashboard.close();
cli.kill('SIGTERM');

if (!Object.values(checks).every(Boolean)) fail('some checks did not pass');
console.log(`SMOKE OK ${JSON.stringify(checks)}`);
process.exit(0);
