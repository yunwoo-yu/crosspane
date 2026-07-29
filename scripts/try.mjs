/**
 * `pnpm try` — 허브와 데모 페이지를 한 번에 띄운다.
 *
 * 손으로 확인하는 경로가 `node packages/cli/dist/index.js` + 다른 터미널에서
 * `node examples/demo/serve.mjs`였는데, 외울 수 없고 둘 중 하나를 잊으면
 * 대시보드가 이유 없이 비어 보인다(실제로 겪었다).
 *
 * 의존성을 쓰지 않는다(concurrently 등) — 이 저장소는 zero-dep 기조가 있고
 * 자식 프로세스 두 개를 띄우는 데 패키지가 필요하지 않다.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const hubEntry = join(root, 'packages/cli/dist/index.js');
const lan = process.argv.includes('--lan');
// 안내 문구가 실제 포트와 어긋나면 그 자체가 혼란의 원인이 된다
const hubPort = process.env.CROSSPANE_PORT ?? '7788';
const demoPort = process.env.PORT ?? '7999';

if (!existsSync(hubEntry)) {
  console.log('dist가 없다 — 먼저 빌드한다 (pnpm build)\n');
  const build = spawn('pnpm', ['build'], { cwd: root, stdio: 'inherit' });
  build.on('exit', (code) => (code === 0 ? start() : process.exit(code ?? 1)));
} else {
  start();
}

function start() {
  const children = [
    run('hub', 'node', [
      hubEntry,
      '--no-open',
      '--port',
      hubPort,
      ...(lan ? ['--host', '0.0.0.0'] : []),
    ]),
    run('demo', 'node', [join(root, 'examples/demo/serve.mjs')]),
  ];

  console.log(
    [
      '',
      `  대시보드   http://localhost:${hubPort}`,
      `  데모 페이지 http://localhost:${demoPort}   ← 여기서 버튼을 눌러야 로그가 흐른다`,
      lan
        ? `  실기기      허브가 출력한 LAN 주소를 폰에서 열 것 (:${demoPort})`
        : '  실기기      pnpm try:lan 으로 다시 띄우면 폰에서 접속할 수 있다',
      '',
    ].join('\n'),
  );

  let shuttingDown = false;
  const shutdown = (reason) => {
    if (shuttingDown) return;
    shuttingDown = true;
    // 어느 쪽이 죽었는지 밝힌다 — 반쪽만 살아 있으면 "빈 대시보드"로 오해한다
    if (reason) console.log(`\n${reason} — 나머지도 함께 내린다`);
    for (const child of children) child.kill('SIGTERM');
    process.exit(reason ? 1 : 0);
  };
  process.on('SIGINT', () => shutdown());
  process.on('SIGTERM', () => shutdown());
  children[0].on('exit', (code) => shutdown(code ? 'hub이 종료됐다' : null));
  children[1].on('exit', (code) => shutdown(code ? 'demo 서버가 종료됐다' : null));
}

/** 출력에 접두사를 붙여 어느 프로세스의 로그인지 구분한다 */
function run(label, command, args) {
  const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = `[${label}]`.padEnd(7);
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8');
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        console.log(`${prefix} ${buffer.slice(0, newline)}`);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
      }
    });
  }
  return child;
}
