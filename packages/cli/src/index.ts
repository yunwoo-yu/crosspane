#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cliVersion, HELP_TEXT, parseCliArguments, parseMcpArguments } from './args.js';
import { setVerbose } from './debug.js';
import { clearEnvFile, writeEnvFile } from './env-file.js';
import { startMcpServer } from './mcp/index.js';
import { agentUrls, startHubServer } from './server.js';

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

  /** LAN 바인딩 여부 — 안내할 주소를 LAN IP로 할지 localhost로 할지 결정한다 */
  const exposed = options.host !== '127.0.0.1' && options.host !== 'localhost';
  /**
   * 이 허브가 이 머신 밖에서 닿는지. **토큰 여부는 이 값으로 정한다.**
   *
   * `--public-url`을 포함해야 한다: 터널·리버스 프록시는 루프백 바인딩이어도 허브를
   * 외부에 노출하며, 그 범위는 LAN보다 넓다(터널이면 인터넷 전체다). `--host`만 보던
   * 동안 `crosspane --public-url https://…`은 **토큰 없는 공개 허브**가 됐다 — 주소를 아는
   * 누구나 세션 로그를 읽고 가짜 세션을 주입할 수 있는 상태다.
   */
  const reachableFromOutside = exposed || options.publicUrl !== undefined;
  /**
   * 외부에서 닿을 때만 토큰을 요구한다. 루프백 전용이면 OS가 이미 막아 주므로 토큰이
   * 마찰만 된다. `--no-auth`는 사내 테스트 자동화용 탈출구다(경고를 함께 찍는다).
   */
  const authToken =
    reachableFromOutside && !options.noAuth ? randomBytes(8).toString('hex') : undefined;
  /**
   * 쓰기 전용 인제스트 키 — 에이전트 주소에 담기는 것은 이것뿐이다.
   *
   * 읽기 토큰을 에이전트에 주지 않는 이유: 배포된 페이지에 에이전트를 넣으면 그 주소가
   * 클라이언트로 들어가 **페이지 소스에 노출된다**(운영 사이트에 붙여 실측했다).
   * 읽기 토큰이 거기 있으면 누구나 세션 로그를 읽는다. 인제스트 키는 공개돼도 되고,
   * 최악이 남이 우리 허브에 쓰레기 세션을 넣는 것이다 — 그래서 프로덕션에 넣을 수 있다.
   */
  const ingestKey = options.ingestKey ?? generatedIngestKey(reachableFromOutside, options.noAuth);
  const tls = readTlsFiles(options.tlsCert, options.tlsKey);
  const server = await startHubServer({
    port: options.port,
    host: options.host,
    authToken,
    ingestKey,
    tls,
    publicUrl: options.publicUrl,
    // 명시된 포트는 존중하고, 기본 포트는 사용 중이면 +1씩 폴백
    portAttempts: options.portExplicit ? 1 : 10,
  });

  const scheme = tls ? 'https' : 'http';
  const tokenQuery = authToken ? `/?t=${authToken}` : '';
  const dashboardUrl = `${scheme}://localhost:${server.port}${tokenQuery}`;
  /**
   * 폴백을 조용히 넘기면 안 된다. **무설정 자동 연결은 기본 포트를 노리기 때문에**
   * (`packages/agent/src/endpoint.ts`) 폴백된 허브를 지나쳐, 세션이 먼저 뜬 다른 허브로
   * 가거나 아무데도 가지 않는다 — 그 상태에서 대시보드는 그냥 비어 있다.
   * 실제로 이 혼란을 겪었고, 허브가 두 개면 원인을 찾기가 매우 어렵다.
   */
  if (server.port !== options.port) {
    console.log(
      `⚠ port ${options.port} is already in use — this hub is on ${server.port} instead.\n` +
        `  An agent with no serverUrl looks for port ${options.port}, so it will NOT find this hub.\n` +
        `  Fix it one of these ways:\n` +
        `    • stop whatever holds ${options.port} and restart (simplest)\n` +
        `    • restart with --write-env, which records port ${server.port} for you\n` +
        `    • point the agent at it yourself: http://localhost:${server.port}`,
    );
  }
  console.log(`crosspane dashboard → ${dashboardUrl}`);
  // 에이전트가 붙을 주소는 허브가 계산한다 (터널·TLS·LAN을 한 곳에서 판단 — server.ts)
  const agentAddresses = agentUrls({
    port: server.port,
    exposed,
    ingestKey,
    publicUrl: options.publicUrl,
    scheme,
  });
  if (reachableFromOutside) {
    for (const address of agentAddresses) {
      console.log(`  live agents → ${address}  (serverUrl for @crosspane/agent)`);
    }
    console.log(
      ingestKey
        ? '  the ?k= key in that URL is write-only: it can send sessions to this hub but not\n' +
            '  read any. That is why it is safe in a deployed page, where the address is visible\n' +
            '  to every visitor. Reading needs the ?t= token above — keep that one off your pages.\n' +
            '  Both change every restart.'
        : '  ⚠ --no-auth: anyone who can reach this hub can read your session logs and inject sessions.',
    );
  } else {
    console.log('  local only — pass --host 0.0.0.0 to receive live agent sessions from devices');
  }
  if (options.ingestKey !== undefined) {
    console.log(
      '  using a fixed ingest key — the address in your app stays valid across restarts.\n' +
        '  Pair it with a stable hostname and you never touch the deployed value again.',
    );
  }
  if (options.publicUrl !== undefined) {
    console.log(
      `  advertising ${options.publicUrl} — make sure it actually forwards to this hub,\n` +
        '  including the WebSocket upgrade on /agent and /ws.\n' +
        '  A tunnel reaches the whole internet, so the token above is what keeps the hub yours;\n' +
        '  session logs also transit the tunnel provider.',
    );
  } else if (!tls) {
    // https 페이지에서 왜 안 되는지를 여기서 알려준다 — 나중에 알면 원인 찾기가 매우 어렵다
    console.log(
      '  note: an https:// page cannot connect to this hub over plain ws://. See --tls-cert\n' +
        '  and --public-url in `crosspane --help` ("Debugging an https:// page").',
    );
  }

  if (options.writeEnv !== undefined) {
    announceEnvFile(options.writeEnv, agentAddresses[0]);
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
 * 인제스트 키를 만든다 — `--ingest-key`로 고정하지 않았을 때만.
 *
 * 기본이 매번 새 값인 이유는 안전한 기본값이지만, **고정할 수 있어야 한다**:
 * 배포된 앱의 주소가 이 키를 담으므로 키가 바뀌면 허브를 재시작할 때마다 앱을 다시
 * 배포해야 한다. 쓰기 전용이라 공개돼도 되는 값이므로 고정에 대가가 없다.
 */
function generatedIngestKey(reachable: boolean, noAuth: boolean): string | undefined {
  return reachable && !noAuth ? randomBytes(8).toString('hex') : undefined;
}

/**
 * TLS 인증서·키 파일을 읽는다. 둘 다 없으면 undefined(평문 허브).
 *
 * 읽기 실패는 기동을 막는다 — TLS를 켜라고 했는데 조용히 평문으로 뜨면, https 페이지에서
 * 왜 안 붙는지 추적할 방법이 없다. 인증서 문제는 시작할 때 알아야 한다.
 */
function readTlsFiles(
  certPath: string | undefined,
  keyPath: string | undefined,
): { cert: string; key: string } | undefined {
  if (certPath === undefined || keyPath === undefined) return undefined;
  try {
    return { cert: readFileSync(certPath, 'utf-8'), key: readFileSync(keyPath, 'utf-8') };
  } catch (err) {
    throw new Error(
      `could not read TLS files: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
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
