import type { BrowserEngineName } from './protocol.js';

export const HELP_TEXT = `crosspane — preview one URL across engines and real devices in a single dashboard

Usage:
  crosspane <url | :port> [options]

Examples:
  crosspane :3000                      # webview profile: Chromium(wv) + WebKit(WKWebView)
  crosspane :3000 --profile device     # + real Android emulator / iOS Simulator panes
  crosspane :3000 --user-agent "MyApp/1.0 (WebView)"

Options:
  --profile <name>     Pane preset — webview | web | device | full (default: webview)
                         webview  Chromium + WebKit (in-app webview engines, fast loop)
                         web      + Firefox (mobile web cross-browsing)
                         device   webview + REAL Android emulator / iOS Simulator panes
                         full     everything
  --engines <list>     Engines to auto-start (chromium,webkit,firefox) — others stay
                       available as stopped panes you can start from the dashboard
  --device <name>      Playwright device preset (default: "iPhone 15")
  --port <n>           Dashboard port (default: 7788)
  --inject <path>      JS file injected into every page before load (bridge mocks etc.)
  --user-agent <ua>    Exact UA for every engine (reproduce your app's custom webview UA)
  --preset-ua          Use Playwright's browser preset UA instead of webview UA emulation
  --fresh              Start with a clean session (ignore saved logins/storage)
  --ios-runtime <ver>  iOS Simulator runtime version (e.g. 17.2) — reproduce old-iOS bugs
  --ios-sim            Force the real iOS Simulator pane regardless of profile
  --no-ios-sim         Disable the iOS Simulator pane
  --android            Force the real Android pane regardless of profile
  --no-android         Disable the Android pane
  -h, --help           Show this help

By default crosspane emulates deployed webview environments: Chromium gets a real
Android WebView UA (with the "wv" token) and WebKit gets a real WKWebView UA
(no Safari token) with service workers blocked, matching production behavior.
`;

export type ProfileName = 'webview' | 'web' | 'device' | 'full';

export interface CliOptions {
  url: string;
  profile: ProfileName;
  engines: BrowserEngineName[];
  /** true=강제 자동시작, false=pane 제외, undefined=SDK 있으면 pane 표시(시작은 프로필 따름) */
  iosSimulator?: boolean;
  /** true=강제 자동시작, false=pane 제외, undefined=SDK 있으면 pane 표시(시작은 프로필 따름) */
  android?: boolean;
  /** 프로필이 실기기 pane을 자동 시작하는지 (device/full) */
  autoStartRealDevices: boolean;
  device: string;
  port: number;
  injectScriptPath?: string;
  /** 모든 엔진에 그대로 적용할 커스텀 UA (실제 앱의 웹뷰 UA 재현용) */
  customUserAgent?: string;
  /** 웹뷰 환경 에뮬레이션(UA/서비스워커) 사용 여부 — 기본 켜짐 */
  emulateWebview: boolean;
  /** 저장된 로그인 세션을 무시하고 깨끗하게 시작 */
  freshSession: boolean;
  /** iOS 시뮬레이터 런타임 버전 (예: "17.2") — 구버전 iOS 재현용 */
  iosRuntime?: string;
}

const SUPPORTED_ENGINES: readonly BrowserEngineName[] = ['chromium', 'webkit', 'firefox'];

/**
 * 프로필 = 유스케이스별 pane 프리셋.
 * 웹뷰 앱 QA에는 Gecko 웹뷰가 존재하지 않으므로 Firefox를 빼고,
 * 무거운 실기기 pane은 배포 전 확인(device/full)에서만 켠다.
 */
const PROFILES: Record<ProfileName, { engines: BrowserEngineName[]; realDevicePanes: boolean }> = {
  webview: { engines: ['chromium', 'webkit'], realDevicePanes: false },
  web: { engines: ['chromium', 'webkit', 'firefox'], realDevicePanes: false },
  device: { engines: ['chromium', 'webkit'], realDevicePanes: true },
  full: { engines: ['chromium', 'webkit', 'firefox'], realDevicePanes: true },
};

const DEFAULT_DEVICE = 'iPhone 15';
const DEFAULT_PORT = 7788;

function parseProfile(value: string): ProfileName {
  if (!(value in PROFILES)) {
    throw new Error(`Unknown profile "${value}" (valid: ${Object.keys(PROFILES).join(', ')})`);
  }
  return value as ProfileName;
}

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

/** 플래그를 순서와 무관하게 수집한 뒤, 프로필 기본값 위에 명시 플래그를 덮어쓴다 */
export function parseCliArguments(argv: string[]): CliOptions {
  const args = [...argv];
  const target = args.shift();
  if (target === undefined) throw new Error(HELP_TEXT);

  let profile: ProfileName = 'webview';
  let explicitEngines: BrowserEngineName[] | undefined;
  let explicitIosSimulator: boolean | undefined;
  let explicitAndroid: boolean | undefined;
  let device = DEFAULT_DEVICE;
  let port = DEFAULT_PORT;
  let injectScriptPath: string | undefined;
  let customUserAgent: string | undefined;
  let emulateWebview = true;
  let freshSession = false;
  let iosRuntime: string | undefined;

  while (args.length > 0) {
    const flag = args.shift();
    if (flag === undefined) break;
    // 값이 없는 불리언 플래그
    if (flag === '--preset-ua') {
      emulateWebview = false;
      continue;
    }
    if (flag === '--fresh') {
      freshSession = true;
      continue;
    }
    if (flag === '--ios-sim') {
      explicitIosSimulator = true;
      continue;
    }
    if (flag === '--no-ios-sim') {
      explicitIosSimulator = false;
      continue;
    }
    if (flag === '--android') {
      explicitAndroid = true;
      continue;
    }
    if (flag === '--no-android') {
      explicitAndroid = false;
      continue;
    }
    const value = args.shift();
    if (value === undefined) throw new Error(`Missing value for ${flag}`);
    switch (flag) {
      case '--profile':
        profile = parseProfile(value);
        break;
      case '--user-agent':
        customUserAgent = value;
        break;
      case '--engines':
        explicitEngines = parseEngineList(value);
        break;
      case '--device':
        device = value;
        break;
      case '--port':
        port = parsePositiveNumberFlag(flag, value);
        break;
      case '--inject':
        injectScriptPath = value;
        break;
      case '--ios-runtime':
        iosRuntime = value;
        break;
      default:
        throw new Error(`Unknown option ${flag}`);
    }
  }

  const preset = PROFILES[profile];
  return {
    url: resolveTargetUrl(target),
    profile,
    engines: explicitEngines ?? [...preset.engines],
    iosSimulator: explicitIosSimulator,
    android: explicitAndroid,
    autoStartRealDevices: preset.realDevicePanes,
    device,
    port,
    injectScriptPath,
    customUserAgent,
    emulateWebview,
    freshSession,
    iosRuntime,
  };
}
