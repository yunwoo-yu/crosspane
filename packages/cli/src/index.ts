#!/usr/bin/env node
import { HELP, parseArgs } from './args.js';
import { resolveDevice } from './devices.js';
import type { EngineName, EngineStatus } from './protocol.js';
import { startServer } from './server.js';
import { EngineSession, type SessionEvents } from './session.js';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
    console.log(HELP);
    process.exit(argv.length === 0 ? 1 : 0);
  }

  const opts = parseArgs(argv);
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

  const events: SessionEvents = {
    onFrame: (engine, data) => server.broadcast({ type: 'frame', engine, data }),
    onConsole: (engine, level, text) =>
      server.broadcast({ type: 'console', engine, level, text, ts: Date.now() }),
    onPageError: (engine, message) =>
      server.broadcast({ type: 'pageerror', engine, message, ts: Date.now() }),
    onRequestFailed: (engine, url, error) =>
      server.broadcast({ type: 'requestfailed', engine, url, error, ts: Date.now() }),
    onStatus: (engine: EngineName, status: EngineStatus, detail?: string) =>
      server.broadcast({ type: 'engine-status', engine, status, detail }),
  };

  console.log(`crosspane dashboard → http://localhost:${opts.port}`);
  console.log(`target: ${opts.url}  device: ${opts.device}  engines: ${opts.engines.join(', ')}`);

  const results = await Promise.allSettled(
    opts.engines.map(async (engine) => {
      const session = await EngineSession.create(
        engine,
        {
          url: opts.url,
          device: opts.device,
          fps: opts.fps,
          injectScriptPath: opts.injectScriptPath,
        },
        events,
      );
      sessions.set(engine, session);
      console.log(`  ✓ ${engine} ready`);
    }),
  );
  for (const [i, result] of results.entries()) {
    if (result.status === 'rejected') {
      console.error(`  ✗ ${opts.engines[i]} failed: ${String(result.reason)}`);
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
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
