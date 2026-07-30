import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** CLI 버전 (package.json) — 버그 리포트 템플릿이 요구하는 정보라 -v로 노출한다 */
export function cliVersion(): string {
  const packageJsonPath = resolve(dirname(fileURLToPath(import.meta.url)), '../package.json');
  return (JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { version: string }).version;
}

export const HELP_TEXT = `crosspane — debug web screens where devtools can't reach

Starts the crosspane hub: a dashboard that receives live sessions from the
@crosspane/agent SDK (webviews, in-app browsers, kiosks) and replays exported
.crosspane.json capture files.

Usage:
  crosspane [options]
  crosspane mcp [--hub <url>]

Examples:
  crosspane                       # dashboard on http://localhost:7788 (replay files, local agents)
  crosspane --host 0.0.0.0        # accept live agents from devices on your network
  crosspane mcp                   # MCP server: let a coding agent query live sessions

Options:
  --port <n>           Dashboard port (default: 7788; the default port falls back +1
                       when taken — an explicitly given port does not)
  --host <addr>        Bind address (default: 127.0.0.1 — local only. Use 0.0.0.0 to
                       receive live agent sessions from phones/devices on your network.
                       Exposing the hub generates two credentials: a write-only ingest key
                       for the agent (?k=, safe in a deployed page whose source anyone can
                       read) and a read token for the dashboard (?t=, keep it off your
                       pages). Use --write-env and you never copy either by hand)
  --write-env [file]   Write this hub's address (with the write-only key) into an env file so
                       the agent needs no arguments at all — defaults to .env.local.
                       Read by Vite/Next/CRA/Astro; the variable name is picked from your
                       package.json. Removed again when the hub stops
  --tls-cert <file>    Serve the hub over https/wss with this certificate (needs --tls-key).
                       Required to debug an https:// page: browsers block plain ws:// from a
                       secure page, and there is no way around it. The certificate has to be
                       one the device already trusts — see "Debugging an https:// page" below
  --tls-key <file>     Private key for --tls-cert
  --public-url <url>   Address to advertise instead of the LAN one, for when the hub sits
                       behind a tunnel or reverse proxy (e.g. https://xyz.trycloudflare.com).
                       --write-env and the dashboard both use it.
                       Defaults to $CROSSPANE_PUBLIC_URL
  --ingest-key <key>   Use this write-only key instead of the saved one. You normally do
                       not need it: the hub generates a key on first run and reuses it from
                       ~/.crosspane/config.json, so an address in a deployed app keeps
                       working. Pass it for a shared team hub or CI.
                       Defaults to $CROSSPANE_INGEST_KEY
  --no-open            Don't open the dashboard in your browser automatically
  --no-auth            Disable the access token that --host adds. Only do this on a
                       network you fully trust: without it, anyone who can reach the
                       hub can read every session's logs and inject fake sessions
  --verbose            Diagnostic logging — include this output when filing a bug report
  -h, --help           Show this help
  -v, --version        Print the crosspane version

Add the agent to your app (dev/QA builds) — no address needed:
  import { initCrosspane } from '@crosspane/agent'
  initCrosspane({ label: 'checkout webview' })

  On localhost it finds the hub by itself. For other environments it is an ordinary env
  var, like any API URL — set NEXT_PUBLIC_CROSSPANE_URL (or VITE_/PUBLIC_/REACT_APP_)
  per environment and leave it out of production; the agent reads it with no extra code.
  --write-env below exists only for the case a static value can't cover: a hub on your
  laptop plus a phone, where the LAN address and token change every restart.

  Pass serverUrl explicitly for a webview the app opens itself — there is no address bar
  in one, so the per-device opt-in link (?__crosspane=on) cannot be used there. That link
  is for pages you open by URL: an in-app browser reached from a chat message or a QR code.
  Offline capture works everywhere regardless — see agent.copyCapture().

Debugging an https:// page (staging, or anything already deployed):
  This is about where you run the hub; the app still just reads its env var.
  A secure page cannot open a plain ws:// connection — that is a browser rule with no
  workaround, so the hub has to be reachable over wss://. If your team already runs a hub
  at a fixed https:// address, put that in your env file and ignore the rest of this.
  Otherwise, to make your own hub reachable:

  1. Tunnel (works on any network, including cellular; no certificate of your own)
       cloudflared tunnel --url http://localhost:7788      # prints https://<id>.trycloudflare.com
       crosspane --public-url https://<id>.trycloudflare.com --write-env
     Session logs pass through the tunnel provider — use it only where that is acceptable.

  2. A certificate the device already trusts (nothing leaves your network)
       crosspane --host 0.0.0.0 --tls-cert cert.pem --tls-key key.pem --write-env
     Works with a corporate CA that is already on your managed devices, or a publicly
     trusted certificate for a name that resolves to your LAN IP.
     A self-signed certificate does NOT work in app webviews: since Android 7 apps do not
     trust user-installed CAs, so no amount of installing helps.

  3. Reverse-proxy the hub through the staging origin itself (same origin, no mixed content)
       crosspane --public-url https://staging.example.com/__crosspane --write-env
     Point that path at the hub from your app server; nothing goes to a third party.

  4. No infrastructure at all: skip live mode and use agent.copyCapture(), which needs
     no network and is unaffected by any of the above.

Keeping a deployed app's address valid:
  The ingest key is handled for you — generated on first run, saved to
  ~/.crosspane/config.json, reused every restart. Nothing to create or copy.

  The other half of the address is the hostname, and a *quick* tunnel picks a new one each
  run. Give it a permanent name once and the value in your app never changes again — a named
  cloudflared tunnel on a domain you already own is free:
       cloudflared tunnel login
       cloudflared tunnel create crosspane
       cloudflared tunnel route dns crosspane crosspane.example.com
       cloudflared tunnel run --url http://localhost:7788 crosspane
       export CROSSPANE_PUBLIC_URL=https://crosspane.example.com
  Tailscale Funnel works too (a fixed *.ts.net name), and a team hub on real infrastructure
  needs none of this.

  Anyone who sees the key can send junk sessions to your hub but cannot read any. Rotate it
  by deleting ~/.crosspane/config.json (then update the app's address).

MCP mode (crosspane mcp):
  Exposes the running hub's sessions to a coding agent over stdio, so it can ask
  "why did the payment webview fail?" and read the console/network itself.
  Register it with your agent, e.g. in .mcp.json:
    { "mcpServers": { "crosspane": { "command": "crosspane", "args": ["mcp"] } } }

  --hub <url>          Hub to attach to (default: http://127.0.0.1:7788). If the hub was
                       started with --host it requires its access token — pass the full
                       URL including it: --hub 'http://127.0.0.1:7788/?t=<token>'
`;

export interface CliOptions {
  port: number;
  /** --port로 명시했는지 — 명시 시 자동 폴백 없이 그 포트만 시도한다 */
  portExplicit: boolean;
  /** 허브 바인드 주소 — 기본 127.0.0.1. 라이브 에이전트 수신은 명시적 노출 필요 */
  host: string;
  /** 기동 후 대시보드를 기본 브라우저로 여는지 (기본 켜짐, --no-open으로 끔) */
  openBrowser: boolean;
  /** 진단 로깅 (--verbose 또는 CROSSPANE_VERBOSE=1) */
  verbose: boolean;
  /** 노출된 허브의 접속 토큰을 끈다 (사내 자동화용 탈출구) */
  noAuth: boolean;
  /** 허브 주소를 적을 env 파일 경로. undefined면 쓰지 않는다 */
  writeEnv: string | undefined;
  /** TLS 인증서·키 파일 경로 — 주면 허브가 https/wss로 뜬다 (https 페이지 지원) */
  tlsCert: string | undefined;
  tlsKey: string | undefined;
  /** 터널·리버스 프록시 뒤에 있을 때 안내할 외부 주소 */
  publicUrl: string | undefined;
  /**
   * 고정 인제스트 키. 주지 않으면 재시작마다 새로 만든다.
   *
   * 왜 고정할 수 있어야 하는가: 배포된 앱에 들어가는 주소가 이 키를 담는데, 키가 매번
   * 바뀌면 허브를 재시작할 때마다 **앱을 다시 배포해야 한다**. 쓰기 전용이라 공개돼도
   * 되는 값이므로 회전시킬 이유가 없다 — 고정 주소(고정 터널·팀 허브)와 합치면
   * 앱에 넣는 값이 영구히 그대로다.
   */
  ingestKey: string | undefined;
}

/** `--write-env`에 경로를 주지 않았을 때. Vite·Next·CRA·Astro가 모두 읽고, 보통 gitignore돼 있다 */
export const DEFAULT_ENV_FILE = '.env.local';

const DEFAULT_PORT = 7788;
const DEFAULT_HOST = '127.0.0.1';

function parsePositiveNumberFlag(flag: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid value for ${flag}: "${value}"`);
  }
  return parsed;
}

/** 빈 문자열은 미설정으로 본다 — 정의만 하고 비운 환경변수가 흔하다 */
function nonEmptyEnv(name: string): string | undefined {
  const value = process.env[name];
  return value !== undefined && value !== '' ? value : undefined;
}

/** 값을 받는 플래그 — 오타를 "Missing value"가 아니라 "Unknown option"으로 안내하기 위한 목록 */
const VALUE_FLAGS = new Set([
  '--port',
  '--host',
  '--tls-cert',
  '--tls-key',
  '--public-url',
  '--ingest-key',
]);

/**
 * `--public-url` 검증. 에이전트가 이 값으로 WebSocket 주소를 만들므로
 * http(s)가 아니면 조용히 연결 실패한다 — 여기서 끊는 편이 낫다.
 */
function parsePublicUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid value for --public-url: "${value}"`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`--public-url must be http(s), got "${value}"`);
  }
  return value;
}

export function parseCliArguments(argv: string[]): CliOptions {
  const args = [...argv];
  let port = DEFAULT_PORT;
  let portExplicit = false;
  let host = DEFAULT_HOST;
  let openBrowser = true;
  let verbose = false;
  let noAuth = false;
  let writeEnv: string | undefined;
  let tlsCert: string | undefined;
  let tlsKey: string | undefined;
  /**
   * 환경변수를 기본값으로 삼는다 — 고정 셋업(고정 터널 + 고정 키)을 셸 프로파일이나
   * 프로젝트 .env에 한 번 넣어 두면 매번 타이핑하지 않는다. 플래그가 항상 이긴다.
   */
  let publicUrl = nonEmptyEnv('CROSSPANE_PUBLIC_URL');
  let ingestKey = nonEmptyEnv('CROSSPANE_INGEST_KEY');

  while (args.length > 0) {
    const flag = args.shift();
    if (flag === undefined) break;
    if (flag === '--no-open') {
      openBrowser = false;
      continue;
    }
    if (flag === '--write-env') {
      // 값이 선택적인 유일한 플래그 — 다음 토큰이 플래그면 값이 없는 것으로 본다.
      // (`--write-env --host 0.0.0.0`이 host를 파일명으로 삼아 버리면 안 된다)
      const next = args[0];
      writeEnv = next !== undefined && !next.startsWith('-') ? args.shift() : DEFAULT_ENV_FILE;
      continue;
    }
    if (flag === '--verbose') {
      verbose = true;
      continue;
    }
    if (flag === '--no-auth') {
      noAuth = true;
      continue;
    }
    // 값을 받는 플래그인지 먼저 판정 — 그래야 오타 플래그가
    // "Missing value"가 아니라 "Unknown option"으로 정확히 안내된다
    if (!VALUE_FLAGS.has(flag)) {
      throw new Error(`Unknown option ${flag}`);
    }
    const value = args.shift();
    if (value === undefined) throw new Error(`Missing value for ${flag}`);
    if (flag === '--port') {
      port = parsePositiveNumberFlag(flag, value);
      portExplicit = true;
    } else if (flag === '--host') {
      host = value;
    } else if (flag === '--tls-cert') {
      tlsCert = value;
    } else if (flag === '--tls-key') {
      tlsKey = value;
    } else if (flag === '--ingest-key') {
      ingestKey = value;
    } else {
      publicUrl = parsePublicUrl(value);
    }
  }

  // 한쪽만 준 것은 거의 확실히 실수다. 조용히 평문으로 뜨면 https 페이지에서
  // 왜 안 붙는지 알 방법이 없다 — 기동 전에 끊는다
  if ((tlsCert === undefined) !== (tlsKey === undefined)) {
    throw new Error('--tls-cert and --tls-key must be given together');
  }

  // 환경변수로 들어온 값도 검증한다 — 잘못된 주소로 조용히 뜨면 진단이 불가능하다
  if (publicUrl !== undefined) parsePublicUrl(publicUrl);

  return {
    port,
    portExplicit,
    host,
    openBrowser,
    verbose,
    noAuth,
    writeEnv,
    tlsCert,
    tlsKey,
    publicUrl,
    ingestKey,
  };
}

export interface McpCliOptions {
  /** 붙을 허브 주소 */
  hubUrl: string;
  verbose: boolean;
}

const DEFAULT_HUB_URL = `http://127.0.0.1:${DEFAULT_PORT}`;

/** `crosspane mcp` 이후의 인자 (서브커맨드 토큰은 호출자가 제거해 넘긴다) */
export function parseMcpArguments(argv: string[]): McpCliOptions {
  const args = [...argv];
  let hubUrl = DEFAULT_HUB_URL;
  let verbose = false;

  while (args.length > 0) {
    const flag = args.shift();
    if (flag === undefined) break;
    if (flag === '--verbose') {
      verbose = true;
      continue;
    }
    if (flag !== '--hub') throw new Error(`Unknown option ${flag}`);
    const value = args.shift();
    if (value === undefined) throw new Error('Missing value for --hub');
    // 포트만 준 경우를 받아준다 — `--hub 7788`이 자연스러운 오타 이상의 기대치다
    const candidate = /^\d+$/.test(value) ? `http://127.0.0.1:${value}` : value;
    try {
      const url = new URL(candidate);
      // 쿼리(접속 토큰)를 버리지 않는다 — 노출된 허브는 토큰 없이 붙을 수 없다.
      // origin만 남기던 예전 구현으로 되돌리면 MCP가 401로 조용히 실패한다.
      // 경로도 버리지 않는다 — 허브가 경로 접두사를 가진 프록시 뒤에 있을 수 있다
      // (`--hub https://x.example/__crosspane`). 버리면 프록시가 매칭하지 못한다
      const path = url.pathname.replace(/\/+$/, '');
      hubUrl = `${url.origin}${path}${url.search}`;
    } catch {
      throw new Error(`Invalid value for --hub: "${value}"`);
    }
  }

  return { hubUrl, verbose };
}
