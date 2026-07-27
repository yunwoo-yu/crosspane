import type { BrowserEngineName } from './protocol.js';

export const HELP_TEXT = `crosspane — preview one URL across Chromium, WebKit and Firefox in a single dashboard

Usage:
  crosspane <url | :port> [options]

Examples:
  crosspane :3000
  crosspane http://localhost:5173 --engines chromium,webkit
  crosspane :3000 --device "iPhone 15" --inject ./bridge-mock.js

Options:
  --engines <list>     Comma-separated engines (default: chromium,webkit,firefox)
  --device <name>      Playwright device preset (default: "iPhone 15")
  --port <n>           Dashboard port (default: 7788)
  --inject <path>      JS file injected into every page before load (bridge mocks etc.)
  --user-agent <ua>    Exact UA for every engine (reproduce your app's custom webview UA)
  --preset-ua          Use Playwright's browser preset UA instead of webview UA emulation
  --ios-sim            Add a REAL iOS Simulator pane (requires Xcode; view-only)
  -h, --help           Show this help

By default crosspane emulates deployed webview environments: Chromium gets a real
Android WebView UA (with the "wv" token) and WebKit gets a real WKWebView UA
(no Safari token) with service workers blocked, matching production behavior.
`;

export interface CliOptions {
  url: string;
  engines: BrowserEngineName[];
  /** 실제 iOS 시뮬레이터 pane 추가 (Xcode 필요, view-only) */
  iosSimulator: boolean;
  device: string;
  port: number;
  injectScriptPath?: string;
  /** 모든 엔진에 그대로 적용할 커스텀 UA (실제 앱의 웹뷰 UA 재현용) */
  customUserAgent?: string;
  /** 웹뷰 환경 에뮬레이션(UA/서비스워커) 사용 여부 — 기본 켜짐 */
  emulateWebview: boolean;
}

const SUPPORTED_ENGINES: readonly BrowserEngineName[] = ['chromium', 'webkit', 'firefox'];

const DEFAULT_OPTIONS = {
  engines: SUPPORTED_ENGINES,
  device: 'iPhone 15',
  port: 7788,
} as const;

function parseEngineList(value: string): BrowserEngineName[] {
  const engines = value.split(',').map((engine) => engine.trim());
  for (const engine of engines) {
    if (!(SUPPORTED_ENGINES as readonly string[]).includes(engine)) {
      throw new Error(`Unknown engine "${engine}" (valid: ${SUPPORTED_ENGINES.join(', ')})`);
    }
  }
  return engines as BrowserEngineName[];
}

function parsePositiveNumberFlag(flag: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid value for ${flag}: "${value}"`);
  }
  return parsed;
}

/** ":3000" / "3000" 같은 포트 축약형을 localhost URL로 확장한다 */
export function resolveTargetUrl(target: string): string {
  return /^:?\d+$/.test(target) ? `http://localhost:${target.replace(':', '')}` : target;
}

export function parseCliArguments(argv: string[]): CliOptions {
  const args = [...argv];
  const target = args.shift();
  if (target === undefined) throw new Error(HELP_TEXT);

  const options: CliOptions = {
    url: resolveTargetUrl(target),
    engines: [...DEFAULT_OPTIONS.engines],
    device: DEFAULT_OPTIONS.device,
    port: DEFAULT_OPTIONS.port,
    emulateWebview: true,
    iosSimulator: false,
  };

  while (args.length > 0) {
    const flag = args.shift();
    if (flag === undefined) break;
    // 값이 없는 불리언 플래그
    if (flag === '--preset-ua') {
      options.emulateWebview = false;
      continue;
    }
    if (flag === '--ios-sim') {
      options.iosSimulator = true;
      continue;
    }
    const value = args.shift();
    if (value === undefined) throw new Error(`Missing value for ${flag}`);
    switch (flag) {
      case '--user-agent':
        options.customUserAgent = value;
        break;
      case '--engines':
        options.engines = parseEngineList(value);
        break;
      case '--device':
        options.device = value;
        break;
      case '--port':
        options.port = parsePositiveNumberFlag(flag, value);
        break;
      case '--inject':
        options.injectScriptPath = value;
        break;
      default:
        throw new Error(`Unknown option ${flag}`);
    }
  }
  return options;
}
