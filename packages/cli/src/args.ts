import type { EngineName } from './protocol.js';

export const HELP = `crosspane — preview one URL across Chromium, WebKit and Firefox in a single dashboard

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
  --fps <n>          Capture frames per second (default: 4)
  --inject <path>    JS file injected into every page before load (bridge mocks etc.)
  -h, --help         Show this help
`;

export interface CliOptions {
  url: string;
  engines: EngineName[];
  device: string;
  port: number;
  fps: number;
  injectScriptPath?: string;
}

const VALID_ENGINES: readonly EngineName[] = ['chromium', 'webkit', 'firefox'];

const DEFAULTS = {
  engines: VALID_ENGINES,
  device: 'iPhone 15',
  port: 7788,
  fps: 4,
} as const;

function parseEngines(value: string): EngineName[] {
  const engines = value.split(',').map((e) => e.trim());
  for (const engine of engines) {
    if (!(VALID_ENGINES as readonly string[]).includes(engine)) {
      throw new Error(`Unknown engine "${engine}" (valid: ${VALID_ENGINES.join(', ')})`);
    }
  }
  return engines as EngineName[];
}

function parsePositiveNumber(flag: string, value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid value for ${flag}: "${value}"`);
  return n;
}

/** ":3000" / "3000" 같은 포트 축약형을 localhost URL로 확장한다 */
export function normalizeTarget(target: string): string {
  return /^:?\d+$/.test(target) ? `http://localhost:${target.replace(':', '')}` : target;
}

export function parseArgs(argv: string[]): CliOptions {
  const args = [...argv];
  const target = args.shift();
  if (target === undefined) throw new Error(HELP);

  const opts: CliOptions = {
    url: normalizeTarget(target),
    engines: [...DEFAULTS.engines],
    device: DEFAULTS.device,
    port: DEFAULTS.port,
    fps: DEFAULTS.fps,
  };

  while (args.length > 0) {
    const flag = args.shift();
    if (flag === undefined) break;
    const value = args.shift();
    if (value === undefined) throw new Error(`Missing value for ${flag}`);
    switch (flag) {
      case '--engines':
        opts.engines = parseEngines(value);
        break;
      case '--device':
        opts.device = value;
        break;
      case '--port':
        opts.port = parsePositiveNumber(flag, value);
        break;
      case '--fps':
        opts.fps = parsePositiveNumber(flag, value);
        break;
      case '--inject':
        opts.injectScriptPath = value;
        break;
      default:
        throw new Error(`Unknown option ${flag}`);
    }
  }
  return opts;
}
