/**
 * `pnpm try` — 허브와 데모 페이지를 한 번에 띄운다.
 *
 * 손으로 확인하는 경로가 `node packages/cli/dist/index.js` + 다른 터미널에서
 * `node examples/demo/serve.mjs`였는데, 외울 수 없고 둘 중 하나를 잊으면
 * 대시보드가 이유 없이 비어 보인다(실제로 겪었다).
 *
 * 의존성을 쓰지 않는다(concurrently 등) — 이 저장소는 zero-dep 기조가 있고
 * 자식 프로세스 두 개를 띄우는 데 패키지가 필요하지 않다.
 *
 * **출력은 영어다** — 기여자가 실행하는 스크립트이고, 이 저장소의 규칙이
 * "사용자 노출 문구는 영어"다 (주석은 한국어).
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const hubEntry = join(root, 'packages/cli/dist/index.js');
const lan = process.argv.includes('--lan');
// 안내 문구가 실제 포트와 어긋나면 그 자체가 혼란의 원인이 된다
const DEFAULT_HUB_PORT = 7788;
const hubPort = process.env.CROSSPANE_PORT ?? String(DEFAULT_HUB_PORT);
const demoPort = process.env.PORT ?? '7999';

if (!existsSync(hubEntry)) {
  console.log('dist is missing — building first (pnpm build)\n');
  const build = spawn('pnpm', ['build'], { cwd: root, stdio: 'inherit' });
  build.on('exit', (code) => (code === 0 ? start() : process.exit(code ?? 1)));
} else {
  start();
}

function start() {
  /** 배너와 데모는 허브가 **실제** 주소를 말한 뒤에 나간다 (아래 startDemo 주석 참조) */
  const children = [];
  let started = false;
  /**
   * 데모 서버는 허브 포트가 확정된 **뒤에** 띄운다. 데모 페이지는 그 포트를 에이전트의
   * serverUrl로 주입하므로, 미리 띄우면 폴백이 일어났을 때 엉뚱한 허브를 가리켜
   * 세션이 사라진다 — 이 스크립트가 막으려는 바로 그 혼란이다.
   */
  const startDemo = (dashboardUrl) => {
    if (started) return;
    started = true;
    const port = new URL(dashboardUrl).port || String(DEFAULT_HUB_PORT);
    children.push(
      run('demo', 'node', [join(root, 'examples/demo/serve.mjs')], undefined, {
        ...process.env,
        CROSSPANE_PORT: port,
        PORT: demoPort,
      }),
    );
    children[children.length - 1].on('exit', (code) =>
      shutdown(code ? 'the demo server exited' : null),
    );
    console.log(
      [
        '',
        `  dashboard   ${dashboardUrl}`,
        `  demo page   http://localhost:${demoPort}   <- click things here; they appear in the dashboard`,
        lan
          ? `  a phone     open http://<the LAN address the hub printed>:${demoPort}`
          : '  a phone     use pnpm try:lan instead to reach this from your Wi-Fi',
        '',
      ].join('\n'),
    );
  };

  children.push(
    run(
      'hub',
      'node',
      [
        hubEntry,
        '--no-open',
        // 기본 포트면 --port를 주지 않는다 — 명시하면 허브의 +1 폴백이 꺼져서
        // `pnpm hub`는 자리를 비켜 가는데 `pnpm try`만 죽는 불일치가 생긴다
        ...(hubPort === String(DEFAULT_HUB_PORT) ? [] : ['--port', hubPort]),
        ...(lan ? ['--host', '0.0.0.0'] : []),
      ],
      (line) => {
        const match = /dashboard → (\S+)/.exec(line);
        if (match) startDemo(match[1]);
      },
    ),
  );
  // 허브가 그 줄을 못 찍는 경우에도 데모는 떠야 한다 (안내 없이 멈춰 있으면 안 된다)
  setTimeout(() => startDemo(`http://localhost:${hubPort}`), 3_000).unref();

  let shuttingDown = false;
  const shutdown = (reason) => {
    if (shuttingDown) return;
    shuttingDown = true;
    // 어느 쪽이 죽었는지 밝힌다 — 반쪽만 살아 있으면 "빈 대시보드"로 오해한다
    if (reason) console.log(`\n${reason} — shutting the other one down too`);
    for (const child of children) child.kill('SIGTERM');
    process.exit(reason ? 1 : 0);
  };
  process.on('SIGINT', () => shutdown());
  process.on('SIGTERM', () => shutdown());
  children[0].on('exit', (code) => shutdown(code ? 'the hub exited' : null));
}

/** 출력에 접두사를 붙여 어느 프로세스의 로그인지 구분한다 */
function run(label, command, args, onLine, env) {
  const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env });
  const prefix = `[${label}]`.padEnd(7);
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8');
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        console.log(`${prefix} ${line}`);
        onLine?.(line);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
      }
    });
  }
  return child;
}
