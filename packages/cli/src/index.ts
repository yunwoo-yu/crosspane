#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { lanAddresses } from './addresses.js';
import { cliVersion, HELP_TEXT, parseCliArguments, parseMcpArguments } from './args.js';
import { setVerbose } from './debug.js';
import { clearEnvFile, writeEnvFile } from './env-file.js';
import { startMcpServer } from './mcp/index.js';
import { startHubServer } from './server.js';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  // MCP 모드는 stdout이 JSON-RPC 전용이다 — help/version보다 먼저 갈라내서
  // 어떤 안내 출력도 프로토콜 스트림에 섞이지 않게 한다
  if (argv[0] === 'mcp') {
    runMcp(argv.slice(1));
    return;
  }
  if (argv.includes('-h') || argv.includes('--help')) {
    console.log(HELP_TEXT);
    process.exit(0);
  }
  if (argv.includes('-v') || argv.includes('--version')) {
    console.log(cliVersion());
    process.exit(0);
  }

  const options = parseCliArguments(argv);
  setVerbose(options.verbose || process.env.CROSSPANE_VERBOSE === '1');

  const exposed = options.host !== '127.0.0.1' && options.host !== 'localhost';
  /**
   * 네트워크에 노출할 때만 토큰을 요구한다. 루프백은 OS가 이미 막아 주므로 토큰이
   * 마찰만 되고, 노출된 허브는 토큰이 없으면 같은 Wi-Fi의 누구나 세션 로그를 읽는다.
   * `--no-auth`는 사내 테스트 자동화용 탈출구다(경고를 함께 찍는다).
   */
  const authToken = exposed && !options.noAuth ? randomBytes(8).toString('hex') : undefined;
  const server = await startHubServer({
    port: options.port,
    host: options.host,
    authToken,
    // 명시된 포트는 존중하고, 기본 포트는 사용 중이면 +1씩 폴백
    portAttempts: options.portExplicit ? 1 : 10,
  });

  const tokenQuery = authToken ? `/?t=${authToken}` : '';
  const dashboardUrl = `http://localhost:${server.port}${tokenQuery}`;
  // 폴백을 조용히 넘기면 안 된다: 앱의 serverUrl은 그대로 기본 포트를 가리키므로
  // 세션이 다른 허브(또는 아무데도)로 가고, 대시보드는 빈 화면을 보여준다.
  // 실제로 이 혼란을 겪었다 — 두 허브가 떠 있으면 원인을 찾기가 매우 어렵다
  if (server.port !== options.port) {
    console.log(
      `⚠ port ${options.port} is already in use — this hub is on ${server.port} instead.\n` +
        `  Point your agent's serverUrl at port ${server.port}, or stop whatever holds ` +
        `${options.port} and restart.`,
    );
  }
  console.log(`crosspane dashboard → ${dashboardUrl}`);
  if (exposed) {
    // 실기기의 에이전트가 접속할 주소를 보여준다 — serverUrl에 넣을 값
    for (const address of lanAddresses()) {
      console.log(
        `  live agents → http://${address}:${server.port}${tokenQuery}  (serverUrl for @crosspane/agent)`,
      );
    }
    console.log(
      authToken
        ? '  the token in those URLs is required — anyone on this network could otherwise read\n' +
            '  your session logs and inject fake sessions. It changes every restart.'
        : '  ⚠ --no-auth: anyone on this network can read your session logs and inject sessions.',
    );
  } else {
    console.log('  local only — pass --host 0.0.0.0 to receive live agent sessions from devices');
  }

  if (options.writeEnv !== undefined) {
    // 기기가 접속할 주소를 적는다. 노출됐으면 LAN 주소(에이전트가 폰에서 붙는 곳),
    // 아니면 루프백 — 폴백 포트로 떴을 때도 정확한 값이 들어간다
    const agentAddress = exposed ? (lanAddresses()[0] ?? 'localhost') : 'localhost';
    announceEnvFile(options.writeEnv, `http://${agentAddress}:${server.port}${tokenQuery}`);
  }

  const isInteractiveTerminal = process.stdin.isTTY === true && process.stdout.isTTY === true;
  if (options.openBrowser && isInteractiveTerminal) openInBrowser(dashboardUrl);

  let shuttingDown = false;
  const shutdown = (code = 0): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\nshutting down…');
    // env를 먼저 지운다: 죽은 주소·토큰이 남으면 다음 실행에서 루프백 기본값을 덮어써
    // 에이전트가 조용히 아무데도 붙지 않는다 (진단이 매우 어려운 상태)
    if (options.writeEnv !== undefined) clearEnvFile(options.writeEnv);
    server.close();
    process.exit(code);
  };
  process.on('SIGINT', () => shutdown());
  process.on('SIGTERM', () => shutdown());

  // 놓친 rejection/예외로 조용히 죽지 않게 — 스택을 남기고 정리 경로를 태운다
  const onFatal = (kind: string) => (err: unknown) => {
    console.error(
      `[crosspane] ${kind}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
    );
    shutdown(1);
  };
  process.on('uncaughtException', onFatal('uncaughtException'));
  process.on('unhandledRejection', onFatal('unhandledRejection'));
}

/**
 * env 파일에 허브 주소를 쓰고 결과를 사람에게 알린다.
 *
 * 조용히 쓰지 않는다: 이 파일에는 **접속 토큰이 들어간다.** 어디에 무엇이 쓰였는지,
 * git에 올라갈 위험이 있는지, 충돌하는 정의가 있는지를 전부 보여야 한다.
 * 쓰기 실패로 허브를 죽이지는 않는다 — env 없이도 대시보드와 오프라인 캡처는 동작한다.
 */
function announceEnvFile(filePath: string, url: string): void {
  let result: ReturnType<typeof writeEnvFile>;
  try {
    result = writeEnvFile(filePath, url);
  } catch (err) {
    console.log(
      `⚠ could not write ${filePath}: ${err instanceof Error ? err.message : String(err)}\n` +
        "  the hub is running — pass the agent's serverUrl by hand, or fix the path and restart.",
    );
    return;
  }
  console.log(`  wrote ${filePath} → ${result.names.join(', ')} (removed when this hub stops)`);
  if (result.gitignored === false) {
    console.log(
      `  ⚠ ${filePath} is NOT gitignored and now contains this hub's access token —\n` +
        '    add it to .gitignore before committing.',
    );
  }
  if (result.conflicts.length > 0) {
    console.log(
      `  ⚠ ${result.conflicts.join(', ')} already defined elsewhere in ${filePath} — ` +
        'which one wins\n    depends on the loader. Remove the other definition.',
    );
  }
}

/**
 * MCP stdio 서버 — 코딩 에이전트가 실기기 세션을 직접 질의한다.
 * stdout에 아무것도 쓰지 않는다 (JSON-RPC 전용 채널).
 */
function runMcp(argv: string[]): void {
  if (argv.includes('-h') || argv.includes('--help')) {
    console.log(HELP_TEXT);
    process.exit(0);
  }
  const options = parseMcpArguments(argv);
  setVerbose(options.verbose || process.env.CROSSPANE_VERBOSE === '1');

  let server: { close(): void } | undefined;
  const shutdown = (): void => {
    server?.close();
    process.exit(0);
  };
  // 클라이언트가 stdin을 닫으면 종료가 정상 경로다 (MCP 스펙의 stdio 수명주기).
  // 처리 중이던 응답을 다 쓴 뒤에 온다 — 즉시 종료하면 잘려 나간다
  server = startMcpServer({ hubUrl: options.hubUrl, onInputEnd: shutdown });
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

/** OS 기본 브라우저로 URL 열기 — 실패해도 조용히 무시 (사용자가 직접 열면 됨) */
function openInBrowser(url: string): void {
  const [command, ...args] =
    process.platform === 'darwin'
      ? ['open', url]
      : process.platform === 'win32'
        ? ['cmd', '/c', 'start', '', url]
        : ['xdg-open', url];
  spawn(command, args, { stdio: 'ignore', detached: true })
    .on('error', () => {})
    .unref();
}

main().catch((err: unknown) => {
  // 스택을 버리지 않는다 — 사용자가 이슈에 붙일 수 있는 유일한 단서다
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
