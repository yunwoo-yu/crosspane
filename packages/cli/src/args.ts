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

Examples:
  crosspane                       # dashboard on http://localhost:7788 (replay files, local agents)
  crosspane --host 0.0.0.0        # accept live agents from devices on your network

Options:
  --port <n>           Dashboard port (default: 7788; the default port falls back +1
                       when taken — an explicitly given port does not)
  --host <addr>        Bind address (default: 127.0.0.1 — local only. Use 0.0.0.0 to
                       receive live agent sessions from phones/devices on your network)
  --no-open            Don't open the dashboard in your browser automatically
  --verbose            Diagnostic logging — include this output when filing a bug report
  -h, --help           Show this help
  -v, --version        Print the crosspane version

Add the agent to your app (dev/QA builds):
  import { initCrosspane } from '@crosspane/agent'
  initCrosspane({ label: 'checkout webview', serverUrl: 'http://<your-ip>:7788' })
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
}

const DEFAULT_PORT = 7788;
const DEFAULT_HOST = '127.0.0.1';

function parsePositiveNumberFlag(flag: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid value for ${flag}: "${value}"`);
  }
  return parsed;
}

export function parseCliArguments(argv: string[]): CliOptions {
  const args = [...argv];
  let port = DEFAULT_PORT;
  let portExplicit = false;
  let host = DEFAULT_HOST;
  let openBrowser = true;
  let verbose = false;

  while (args.length > 0) {
    const flag = args.shift();
    if (flag === undefined) break;
    if (flag === '--no-open') {
      openBrowser = false;
      continue;
    }
    if (flag === '--verbose') {
      verbose = true;
      continue;
    }
    // 값을 받는 플래그인지 먼저 판정 — 그래야 오타 플래그가
    // "Missing value"가 아니라 "Unknown option"으로 정확히 안내된다
    if (flag !== '--port' && flag !== '--host') {
      throw new Error(`Unknown option ${flag}`);
    }
    const value = args.shift();
    if (value === undefined) throw new Error(`Missing value for ${flag}`);
    if (flag === '--port') {
      port = parsePositiveNumberFlag(flag, value);
      portExplicit = true;
    } else {
      host = value;
    }
  }

  return { port, portExplicit, host, openBrowser, verbose };
}
