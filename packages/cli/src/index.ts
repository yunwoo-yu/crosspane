#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { lanAddresses } from './addresses.js';
import { cliVersion, HELP_TEXT, parseCliArguments, parseMcpArguments } from './args.js';
import { loadConfig, saveConfigValue } from './config.js';
import { setVerbose } from './debug.js';
import { clearEnvFile, writeEnvFile } from './env-file.js';
import { dnsBlockedMessage, ensureLanTls, resolvesToSelf } from './lan-tls.js';
import { startMcpServer } from './mcp/index.js';
import { agentUrls, startHubServer } from './server.js';
import {
  pickProvider,
  startNamedTunnel,
  startTunnel,
  TUNNEL_PROVIDERS,
  type Tunnel,
} from './tunnel.js';

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

  /**
   * 고정 터널 주소는 한 번 주면 기억한다 — 매 기동마다 다시 타이핑하게 만들면 결국
   * 셸 프로파일에 export를 넣게 되고, 그건 사용자가 관리할 값을 늘리는 것이다.
   * 우선순위: 플래그·환경변수 > 저장값. `--public-url ''`로 지울 수 있다.
   */
  /**
   * 터널을 우리가 띄운다면 그 주소가 저장값·플래그보다 먼저다 — 방금 만든 터널이
   * 지금 살아 있는 주소이고, 저장된 예전 주소는 죽어 있을 수 있다.
   */
  const tunnel = options.tunnel ? await openTunnel(options.port, options.hostname) : undefined;
  /**
   * `--lan-tls`: LAN을 https/wss로 여는 신뢰 인증서. 주소는 **포트가 확정된 뒤에** 만든다 —
   * 기본 포트가 점유되면 +1로 폴백하므로 여기서 만들면 틀린 주소를 안내하게 된다.
   * 사용자가 직접 준 `--tls-cert`가 항상 이긴다.
   */
  /**
   * `--lan-tls`는 "다른 기기에서 이 허브에 붙어라"는 뜻이고, LAN 바인딩은 그 의도의
   * 필연적 결과다. 예전에는 `--host 0.0.0.0`을 함께 주지 않으면 그냥 종료했는데,
   * 그건 사용자가 이미 말한 것을 한 번 더 말하게 하는 마찰일 뿐이었다.
   * 다만 LAN 노출은 조용히 하지 않는다 — 아래에서 어떤 주소로 열렸는지 밝힌다.
   */
  const host = options.lanTls && isLoopback(options.host) ? '0.0.0.0' : options.host;
  const lanTls =
    options.lanTls && options.tlsCert === undefined ? await openLanTls(host) : undefined;
  const savedPublicUrl = loadConfig().publicUrl;
  // `--public-url ''`는 저장된 값을 지운다 (터널을 그만 쓸 때)
  const cleared = options.publicUrl === '';
  const publicUrl = tunnel?.url ?? (cleared ? undefined : (options.publicUrl ?? savedPublicUrl));
  const publicUrlIsNew =
    tunnel === undefined &&
    options.publicUrl !== undefined &&
    options.publicUrl !== '' &&
    options.publicUrl !== savedPublicUrl;
  if (publicUrlIsNew && options.publicUrl !== undefined) {
    saveConfigValue('publicUrl', options.publicUrl);
  } else if (cleared && savedPublicUrl !== undefined) {
    saveConfigValue('publicUrl', '');
    console.log('  forgot the saved --public-url');
  }

  /** LAN 바인딩 여부 — 안내할 주소를 LAN IP로 할지 localhost로 할지 결정한다 */
  const exposed = !isLoopback(host);
  /**
   * 이 허브가 이 머신 밖에서 닿는지. **토큰 여부는 이 값으로 정한다.**
   *
   * `--public-url`을 포함해야 한다: 터널·리버스 프록시는 루프백 바인딩이어도 허브를
   * 외부에 노출하며, 그 범위는 LAN보다 넓다(터널이면 인터넷 전체다). `--host`만 보던
   * 동안 `crosspane --public-url https://…`은 **토큰 없는 공개 허브**가 됐다 — 주소를 아는
   * 누구나 세션 로그를 읽고 가짜 세션을 주입할 수 있는 상태다.
   */
  const reachableFromOutside = exposed || publicUrl !== undefined;
  /**
   * 외부에서 닿을 때만 토큰을 요구한다. 루프백 전용이면 OS가 이미 막아 주므로 토큰이
   * 마찰만 된다. `--no-auth`는 사내 테스트 자동화용 탈출구다(경고를 함께 찍는다).
   */
  const authToken =
    reachableFromOutside && !options.noAuth ? randomBytes(8).toString('hex') : undefined;
  /**
   * 인제스트 키는 **옵트인이다.** 자동 생성하지 않는다 — 생성하면 앱 env에 `?k=…`를 붙여
   * 관리해야 하고, 그 값이 지키는 것은 "주소를 추측 못 하게" 뿐인데 그건 호스트명이 이미
   * 한다(`server.ts`의 `isIngestAuthorized` 주석). 읽기는 토큰 필수로 남는다.
   */
  const ingestKey = options.ingestKey ?? loadConfig().ingestKey;
  /**
   * `--lan-tls`: 기기가 신뢰하는 인증서로 LAN을 https/wss로 연다.
   * 명시한 `--tls-cert`가 있으면 그것이 이긴다 — 사용자가 직접 준 것이 항상 우선이다.
   */
  const tls = readTlsFiles(options.tlsCert, options.tlsKey) ?? lanTls?.material;
  const server = await startHubServer({
    port: options.port,
    host,
    authToken,
    ingestKey,
    tls,
    publicUrl,
    // 인증서가 덮는 이름으로 안내해야 한다 — LAN IP는 이름이 맞지 않아 조용히 실패한다
    tlsHostname: lanTls?.hostname,
    /**
     * 세션이 붙고 끊길 때 터미널에 알린다. 대시보드를 열지 않아도 "붙었는지"와
     * "어느 페이지인지"를 알 수 있어야 한다 — 붙였는데 아무 반응이 없으면
     * 사용자는 주소가 틀렸는지 코드가 안 도는지 구분하지 못한다.
     */
    onSessionChange: ({ kind, session }) => {
      const where = session.url === undefined ? '' : `  ${session.url}`;
      console.log(
        kind === 'joined' ? `● session · ${session.label}${where}` : `○ ended   · ${session.label}`,
      );
    },
    // 명시된 포트는 존중하고, 기본 포트는 사용 중이면 +1씩 폴백
    portAttempts: options.portExplicit ? 1 : 10,
  });

  const scheme = tls ? 'https' : 'http';
  const tokenQuery = authToken ? `/?t=${authToken}` : '';
  /**
   * 대시보드 주소. **TLS면 인증서가 덮는 이름을 써야 한다** — `localhost`로 안내하면
   * 이름이 맞지 않아 페이지는 경고를 넘겨 뜨더라도 **WebSocket이 영영 붙지 않는다**
   * (브라우저는 WS 핸드셰이크에서 인증서 예외를 허용하지 않는다 — 실측).
   * 그 상태가 화면에는 그냥 `connecting…`으로만 보여서 원인을 찾기가 매우 어렵다.
   */
  const dashboardHost = lanTls?.hostname ?? 'localhost';
  const dashboardUrl = `${scheme}://${dashboardHost}:${server.port}${tokenQuery}`;
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
    // --lan-tls면 인증서가 덮는 이름으로 안내해야 한다 — 원시 IP로는 인증서가 맞지 않는다
    publicUrl: publicUrl ?? (lanTls ? `https://${lanTls.hostname}:${server.port}` : undefined),
    scheme,
  });
  if (reachableFromOutside) {
    for (const address of agentAddresses) {
      console.log(`  live agents → ${address}  (serverUrl for @crosspane/agent)`);
    }
    console.log(
      options.noAuth
        ? '  ⚠ --no-auth: anyone who can reach this hub can read your session logs.'
        : '  that address is all your app needs — no key to carry. Reading sessions needs the\n' +
            '  ?t= token in the dashboard URL above, which stays on this machine; sending them\n' +
            '  does not, so the address is safe in a page whose source anyone can read.\n' +
            (ingestKey === undefined
              ? '  Anyone who knows the address can also send junk sessions here (not read yours).\n' +
                '  Close that with --ingest-key if this hub is long-lived and shared.'
              : '  --ingest-key is set, so senders must include ?k= too.'),
    );
  } else {
    console.log(
      '  local only — nothing outside this machine can reach it yet.\n' +
        '  To debug a page on your phone:  crosspane --lan-tls   (works for https:// pages too)',
    );
  }

  if (publicUrl !== undefined) {
    console.log(
      `  advertising ${publicUrl}${publicUrlIsNew ? ' (remembered — no flag needed next time)' : ''} — make sure it actually forwards to this hub,\n` +
        '  including the WebSocket upgrade on /agent and /ws.\n' +
        '  A tunnel reaches the whole internet, so the token above is what keeps the hub yours;\n' +
        '  session logs also transit the tunnel provider.',
    );
  } else if (!tls) {
    // https 페이지에서 왜 안 되는지를 여기서 알려준다 — 나중에 알면 원인 찾기가 매우 어렵다
    console.log(
      /*
       * `--lan-tls`를 먼저 말한다. 이 제약을 실제로 없애는 것이 그것이고,
       * 예전 문구는 인증서를 직접 준비하라는 두 가지만 가리켜 우리가 이미 해결해 둔
       * 길을 사용자에게 숨기고 있었다.
       */
      '  note: an https:// page cannot connect to this hub over plain ws://.\n' +
        '  Fix it with:  crosspane --lan-tls   (fetches a certificate browsers already trust)\n' +
        '  Or bring your own with --tls-cert / --public-url — see `crosspane --help`.',
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
    tunnel?.stop();
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

function isLoopback(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

/**
 * LAN용 신뢰 인증서를 준비한다. 실패하면 원인과 대안을 남기고 종료한다 —
 * `--lan-tls`를 줬는데 조용히 평문으로 뜨면 https 페이지에서 왜 안 붙는지 알 수 없다.
 */
async function openLanTls(
  host: string,
): Promise<{ material: { cert: string; key: string }; hostname: string } | undefined> {
  const ip = isLoopback(host) ? undefined : lanAddresses()[0];
  if (ip === undefined) {
    console.error(
      '--lan-tls found no LAN address on this machine — connect to a network and try again.',
    );
    process.exit(1);
  }
  try {
    const material = await ensureLanTls(ip);
    // 이 네트워크에서 실제로 해석되는지 먼저 본다 — 안 되면 사용자는 원인 없는 실패를 만난다
    if (!(await resolvesToSelf(material.hostname, ip))) {
      console.error(dnsBlockedMessage(material.hostname, ip));
      process.exit(1);
    }
    return { material, hostname: material.hostname };
  } catch (err) {
    console.error(
      `--lan-tls failed: ${err instanceof Error ? err.message : String(err)}\n` +
        '  Bring your own certificate with --tls-cert / --tls-key, or use --tunnel instead.',
    );
    process.exit(1);
  }
}

/**
 * 터널을 띄운다. 실패하면 원인과 조치를 남기고 종료한다 — `--tunnel`을 줬는데 조용히
 * 터널 없이 뜨면 `https://` 페이지에서 왜 안 붙는지 추적할 방법이 없다.
 */
async function openTunnel(port: number, hostname: string | undefined): Promise<Tunnel | undefined> {
  // 고정 주소를 요청했으면 named 터널 — 배포된 앱은 주소가 바뀌면 안 된다
  if (hostname !== undefined) {
    if (!which('cloudflared')) {
      console.error(
        '--hostname needs cloudflared, which is not on your PATH. Either install it:\n' +
          '    brew install cloudflared        (macOS; also apt/yum/winget — Cloudflare docs)\n' +
          '    npx cloudflared --version       (no install; community npm wrapper around the\n' +
          '                                     official binary, not published by Cloudflare)\n' +
          '  …or get a permanent address another way and pass --public-url instead:\n' +
          '    tailscale funnel 7788           (stable *.ts.net, no domain needed)\n' +
          '    a hub on your own infrastructure with a normal certificate\n' +
          '  For a throwaway address, --tunnel alone works with ngrok too.',
      );
      process.exit(1);
    }
    try {
      const named = await startNamedTunnel({ hostname, port });
      console.log(`tunnel (${named.provider}) → ${named.url}  — permanent address`);
      return named;
    } catch (err) {
      console.error(`--hostname failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  }
  const provider = pickProvider((command) => which(command));
  if (provider === undefined) {
    console.error(
      '--tunnel needs cloudflared or ngrok on your PATH (crosspane does not download binaries):\n' +
        TUNNEL_PROVIDERS.map((p) => `  ${p.command}: ${p.install}`).join('\n'),
    );
    process.exit(1);
  }
  try {
    const tunnel = await startTunnel(provider, port);
    console.log(
      `tunnel (${tunnel.provider}) → ${tunnel.url}\n` +
        '  this address changes on every run — fine with --write-env, but a deployed app needs\n' +
        '  a permanent one: add --hostname <name>',
    );
    return tunnel;
  } catch (err) {
    console.error(`--tunnel failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/** PATH에 실행 파일이 있는지 — 없는 바이너리를 spawn해 ENOENT로 죽지 않게 미리 본다 */
function which(command: string): boolean {
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', [command], {
    stdio: 'ignore',
  });
  return probe.status === 0;
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
