#!/usr/bin/env node
// E2E 스모크 하네스: 실제 CLI를 기동해 파이프라인 전체를 검증한다.
// 유닛테스트가 못 잡는 회귀(엔진 기동, 프레임 스트림, 콘솔 수집, 입력 미러링)를
// chromium 1개 엔진으로 빠르게 확인한다. CI와 로컬(pnpm smoke) 공용.
import { spawn } from 'node:child_process';
import http from 'node:http';

const APP_PORT = 7998;
const CROSSPANE_PORT = 7997;
const TIMEOUT_MS = 90_000;

const TEST_PAGE = `<!doctype html><html><body style="height:3000px">
<h1>smoke</h1><script>console.log('smoke-page-loaded')</script></body></html>`;

const appServer = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(TEST_PAGE);
});
await new Promise((resolve) => appServer.listen(APP_PORT, resolve));

const cli = spawn(
  process.execPath,
  [
    'packages/cli/dist/index.js',
    `:${APP_PORT}`,
    '--port',
    String(CROSSPANE_PORT),
    '--engines',
    'chromium',
    '--no-ios-sim',
    '--no-android',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
let cliOutput = '';
cli.stdout.on('data', (chunk) => {
  cliOutput += chunk;
});
cli.stderr.on('data', (chunk) => {
  cliOutput += chunk;
});

function cleanup(code) {
  cli.kill('SIGKILL');
  appServer.close();
  process.exit(code);
}

function fail(reason) {
  console.error(`SMOKE FAIL: ${reason}`);
  console.error('--- checks ---', JSON.stringify(checks));
  console.error('--- cli output ---');
  console.error(cliOutput);
  cleanup(1);
}

setTimeout(() => fail('timeout'), TIMEOUT_MS);

// 대시보드 HTTP가 뜰 때까지 대기
for (let attempt = 0; ; attempt++) {
  try {
    const res = await fetch(`http://localhost:${CROSSPANE_PORT}`);
    if (res.ok) break;
  } catch {
    // 아직 안 뜸
  }
  if (attempt > 100) fail('dashboard not reachable');
  await new Promise((resolve) => setTimeout(resolve, 300));
}

const checks = {
  helloWithChromium: false, // 세션 구성 브로드캐스트
  jpegFramePacket: false, // 바이너리 프레임 (패킷 v3: [type=1][engine=0][flags][scrollY][JPEG])
  consoleCaptured: false, // 페이지 콘솔 로그 수집
  frameAfterInput: false, // 입력(스크롤) 후 새 프레임 = 미러링+활동 부스트
};
let frameCount = 0;
let inputSent = false;

const ws = new WebSocket(`ws://localhost:${CROSSPANE_PORT}/ws`);
ws.binaryType = 'arraybuffer';

ws.onmessage = (event) => {
  if (typeof event.data === 'string') {
    const message = JSON.parse(event.data);
    if (message.type === 'hello' && message.engines.includes('chromium')) {
      checks.helloWithChromium = true;
    }
    if (message.type === 'console' && message.text.includes('smoke-page-loaded')) {
      checks.consoleCaptured = true;
    }
  } else {
    const bytes = new Uint8Array(event.data);
    if (bytes[0] === 1 && bytes[1] === 0 && bytes[7] === 0xff && bytes[8] === 0xd8) {
      frameCount += 1;
      checks.jpegFramePacket = true;
      if (inputSent && frameCount > 1) checks.frameAfterInput = true;
    }
  }
  if (Object.values(checks).every(Boolean)) {
    console.log(`SMOKE OK ${JSON.stringify(checks)}`);
    cleanup(0);
  }
};

ws.onopen = () => {
  // 첫 프레임이 흐른 뒤 입력을 미러링해 응답 프레임을 유도한다
  setTimeout(() => {
    inputSent = true;
    ws.send(JSON.stringify({ type: 'scroll', deltaY: 600 }));
    ws.send(JSON.stringify({ type: 'click', x: 0.5, y: 0.2 }));
  }, 3_000);
};
