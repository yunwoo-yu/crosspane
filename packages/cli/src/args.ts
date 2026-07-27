import type { EngineName } from './protocol.js';

export const HELP_TEXT = `crosspane — preview one URL across Chromium, WebKit and Firefox in a single dashboard

Usage:
  crosspane <url | :port> [options]

Examples:
  crosspane :3000
  crosspane http://localhost:5173 --engines chromium,webkit
  crosspane :3000 --device "iPhone 15" --inject ./bridge-mock.js

Options:
  --engines <list>   Comma-separated engines (default: chromium,webkit,firefox)
  --device <name>    Playwright device preset (default: "iPhone 15")
  --port <n>         Dashboard port (default: 7788)
  --inject <path>    JS file injected into every page before load (bridge mocks etc.)
  -h, --help         Show this help
`;

export interface CliOptions {
  url: string;
  engines: EngineName[];
  device: string;
  port: number;
  injectScriptPath?: string;
}

const SUPPORTED_ENGINES: readonly EngineName[] = ['chromium', 'webkit', 'firefox'];

const DEFAULT_OPTIONS = {
  engines: SUPPORTED_ENGINES,
  device: 'iPhone 15',
  port: 7788,
} as const;

function parseEngineList(value: string): EngineName[] {
  const engines = value.split(',').map((engine) => engine.trim());
  for (const engine of engines) {
    if (!(SUPPORTED_ENGINES as readonly string[]).includes(engine)) {
      throw new Error(`Unknown engine "${engine}" (valid: ${SUPPORTED_ENGINES.join(', ')})`);
    }
  }
  return engines as EngineName[];
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
  };

  while (args.length > 0) {
    const flag = args.shift();
    if (flag === undefined) break;
    const value = args.shift();
    if (value === undefined) throw new Error(`Missing value for ${flag}`);
    switch (flag) {
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
