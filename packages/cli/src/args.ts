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
  crosspane --tunnel --write-env  # reachable from any device, address written into .env.local
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
  --tunnel             Start a tunnel with an installed cloudflared or ngrok and advertise
                       its address — one command instead of two terminals and a copy-paste.
                       Needed for an https:// page, which cannot use plain ws://.
                       Session logs transit that provider; nothing is downloaded for you.
                       Pair with --write-env and there is nothing to copy at all
  --hostname <name>    Use a permanent address instead of a throwaway one, e.g.
                       crosspane.example.com. With --tunnel, crosspane creates and routes a
                       named Cloudflare tunnel for you (idempotent, so it is also the daily
                       command). Needed for a deployed app, whose address lives in your
                       deployment config and must not change. Requires a Cloudflare-managed
                       domain and one "cloudflared tunnel login".
                       Defaults to $CROSSPANE_HOSTNAME
  --public-url <url>   Address to advertise instead of the LAN one, for when the hub sits
                       behind a tunnel or reverse proxy (e.g. https://xyz.trycloudflare.com).
                       --write-env and the dashboard both use it. **Given once, remembered** —
                       later runs need no flag. Pass an empty string to forget it.
                       Also reads $CROSSPANE_PUBLIC_URL
  --ingest-key <key>   Require senders to include ?k=<key> as well. Off by default so the
                       address is all your app needs; the cost of turning it on is carrying
                       the key in your app's env var. Worth it for a hub that is long-lived
                       and shared, where junk sessions from strangers would be a nuisance.
                       Reading sessions always needs the ?t= token, key or no key.
                       Defaults to $CROSSPANE_INGEST_KEY
  --no-open            Don't open the dashboard in your browser automatically
  --no-auth            Disable the access token that --host adds. Only do this on a
                       network you fully trust: without it, anyone who can reach the
                       hub can read every session's logs and inject fake sessions
  --verbose            Diagnostic logging — include this output when filing a bug report
  -h, --help           Show this help
  -v, --version        Print the crosspane version

One setup for every environment:
  npm install @crosspane/agent

    import { initCrosspane } from '@crosspane/agent'
    initCrosspane({
      label: 'checkout webview',
      serverUrl: process.env.NEXT_PUBLIC_CROSSPANE_URL,   // Vite: import.meta.env.VITE_...
    })

    NEXT_PUBLIC_CROSSPANE_URL=https://crosspane.example.com

  Just the address, like any other base URL, and the same value works from localhost, a phone,
  a deployed http:// or https:// page and over cellular. Sending sessions needs no credential;
  reading them needs the ?t= token, which stays on this machine.

  For a hub reachable from anywhere, one command:
       crosspane --tunnel --write-env
  It starts your installed cloudflared/ngrok, advertises that address, and writes it into
  .env.local — nothing to copy. Stopping the hub stops the tunnel and removes the entry.

  A deployed app needs an address that does not change, since it lives in your deployment
  config. Give it a hostname and crosspane sets the permanent tunnel up itself:
       cloudflared tunnel login                             # once, opens a browser
       crosspane --tunnel --hostname crosspane.example.com   # every day (idempotent)
  It creates the named tunnel, routes DNS and runs it. Only the login needs a human: a
  permanent hostname belongs to an account, and that account needs a browser once.
  (ngrok free refuses custom subdomains; Tailscale Funnel gives a stable *.ts.net with no
  domain at all — point --public-url at it instead.)

  On localhost you can omit the env var entirely — the agent finds http://localhost:7788 itself.

Who actually streams:
  By default every install with that address does, which is what a dev or QA build wants. If the
  same build reaches people you would rather not hear from, gate on what your app already knows —
  enabled: false installs no hooks at all:
       initCrosspane({ serverUrl: HUB, enabled: () => user.isQA })
  That is the right gate for a webview the app opens itself: there is no address bar in one, so
  nothing URL-based works there. For a page with no user model, isDebugActivated gates on a link
  (?__crosspane=on / =off) instead. agent.copyCapture() needs no network at all.

Can't route logs through a tunnel?
  Any of these replaces it and the app code above is unchanged — only the address differs:
    - a team hub on your own infrastructure with a normal certificate
    - your own certificate: --tls-cert / --tls-key (a corporate CA already on your devices, or a
      public certificate for a name resolving to your LAN IP). A self-signed one does NOT work in
      app webviews: since Android 7 apps do not trust user-installed CAs
    - a reverse proxy on your own origin: --public-url https://staging.example.com/__crosspane
    - plain HTTP on your LAN: --host 0.0.0.0 --write-env. Simplest, but an https:// page cannot
      use it — browsers block plain ws:// there

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
  /** `--tunnel` — 설치된 cloudflared/ngrok을 허브가 직접 띄워 그 주소를 쓴다 */
  tunnel: boolean;
  /**
   * `--hostname` — 고정 주소 named 터널. 배포된 앱은 주소가 배포 설정에 들어가므로
   * 실행마다 바뀌는 퀵 터널로는 안 된다. 주면 create·route까지 우리가 한다.
   */
  hostname: string | undefined;
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
  '--hostname',
]);

/**
 * `--public-url` 검증. 에이전트가 이 값으로 WebSocket 주소를 만들므로
 * http(s)가 아니면 조용히 연결 실패한다 — 여기서 끊는 편이 낫다.
 */
function parsePublicUrl(value: string): string {
  // 빈 문자열은 "저장된 값을 지운다"는 뜻이다 — 지우는 방법이 파일 편집뿐이면 안 된다
  if (value === '') return '';
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
  let tunnel = false;
  let hostname = nonEmptyEnv('CROSSPANE_HOSTNAME');

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
    if (flag === '--tunnel') {
      tunnel = true;
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
    } else if (flag === '--hostname') {
      hostname = value;
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
    tunnel,
    hostname,
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
