#!/usr/bin/env node
import { EngineSession, resolveDevice } from './session.js';
import { startServer } from './server.js';
import type { EngineName, ServerMessage } from './protocol.js';

const HELP = `crosspane — preview one URL across Chromium, WebKit and Firefox in a single dashboard

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

interface CliOptions {
  url: string;
  engines: EngineName[];
  device: string;
  port: number;
  fps: number;
  injectScriptPath?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const args = [...argv];
  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    console.log(HELP);
    process.exit(args.length === 0 ? 1 : 0);
  }

  const target = args.shift()!;
  const url = /^:?\d+$/.test(target)
    ? `http://localhost:${target.replace(':', '')}`
    : target;

  const opts: CliOptions = {
    url,
    engines: ['chromium', 'webkit', 'firefox'],
    device: 'iPhone 15',
    port: 7788,
    fps: 4,
  };

  while (args.length > 0) {
    const flag = args.shift()!;
    const value = args.shift();
    if (value === undefined) throw new Error(`Missing value for ${flag}`);
    switch (flag) {
      case '--engines': {
        const engines = value.split(',').map((e) => e.trim()) as EngineName[];
        const valid: EngineName[] = ['chromium', 'webkit', 'firefox'];
        for (const e of engines) {
          if (!valid.includes(e)) throw new Error(`Unknown engine "${e}" (valid: ${valid.join(', ')})`);
        }
        opts.engines = engines;
        break;
      }
      case '--device':
        opts.device = value;
        break;
      case '--port':
        opts.port = Number(value);
        break;
      case '--fps':
        opts.fps = Number(value);
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

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const viewport = resolveDevice(opts.device);

  const sessions = new Map<EngineName, EngineSession>();
  const server = await startServer({
    port: opts.port,
    sessions,
    hello: () => ({
      type: 'hello',
      url: opts.url,
      device: opts.device,
      engines: opts.engines,
      viewport,
    }),
  });

  const events = {
    onFrame: (engine: EngineName, data: string) =>
      server.broadcast({ type: 'frame', engine, data }),
    onConsole: (engine: EngineName, level: string, text: string) =>
      server.broadcast({ type: 'console', engine, level, text, ts: Date.now() }),
    onPageError: (engine: EngineName, message: string) =>
      server.broadcast({ type: 'pageerror', engine, message, ts: Date.now() }),
    onRequestFailed: (engine: EngineName, url: string, error: string) =>
      server.broadcast({ type: 'requestfailed', engine, url, error, ts: Date.now() }),
    onStatus: (engine: EngineName, status: 'starting' | 'ready' | 'error', detail?: string) =>
      server.broadcast({ type: 'engine-status', engine, status, detail } satisfies ServerMessage),
  };

  console.log(`crosspane dashboard → http://localhost:${opts.port}`);
  console.log(`target: ${opts.url}  device: ${opts.device}  engines: ${opts.engines.join(', ')}`);

  const results = await Promise.allSettled(
    opts.engines.map(async (engine) => {
      const session = await EngineSession.create(
        engine,
        { url: opts.url, device: opts.device, fps: opts.fps, injectScriptPath: opts.injectScriptPath },
        events,
      );
      sessions.set(engine, session);
      console.log(`  ✓ ${engine} ready`);
    }),
  );
  for (const [i, r] of results.entries()) {
    if (r.status === 'rejected') {
      console.error(`  ✗ ${opts.engines[i]} failed: ${r.reason}`);
      console.error(`    (missing browser? run: pnpm exec playwright install ${opts.engines[i]})`);
    }
  }
  if (sessions.size === 0) {
    server.close();
    throw new Error('No engine could be started.');
  }

  const shutdown = async (): Promise<void> => {
    console.log('\nshutting down…');
    await Promise.allSettled([...sessions.values()].map((s) => s.close()));
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
