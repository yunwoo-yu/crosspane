#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { cliVersion, HELP_TEXT, parseCliArguments, parseMcpArguments } from './args.js';
import { setVerbose } from './debug.js';
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
  const server = await startHubServer({
    port: options.port,
    host: options.host,
    // 명시된 포트는 존중하고, 기본 포트는 사용 중이면 +1씩 폴백
    portAttempts: options.portExplicit ? 1 : 10,
  });

  const dashboardUrl = `http://localhost:${server.port}`;
  console.log(`crosspane dashboard → ${dashboardUrl}`);
  if (exposed) {
    // 실기기의 에이전트가 접속할 주소를 보여준다 — serverUrl에 넣을 값
    for (const address of lanAddresses()) {
      console.log(
        `  live agents → http://${address}:${server.port}  (serverUrl for @crosspane/agent)`,
      );
    }
  } else {
    console.log('  local only — pass --host 0.0.0.0 to receive live agent sessions from devices');
  }

  const isInteractiveTerminal = process.stdin.isTTY === true && process.stdout.isTTY === true;
  if (options.openBrowser && isInteractiveTerminal) openInBrowser(dashboardUrl);

  let shuttingDown = false;
  const shutdown = (code = 0): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\nshutting down…');
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

/** LAN에서 접근 가능한 IPv4 주소 목록 — 에이전트 serverUrl 안내용 */
function lanAddresses(): string[] {
  const addresses: string[] = [];
  for (const nets of Object.values(networkInterfaces())) {
    for (const net of nets ?? []) {
      if (net.family === 'IPv4' && !net.internal) addresses.push(net.address);
    }
  }
  return addresses.length > 0 ? addresses : ['<your-ip>'];
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
