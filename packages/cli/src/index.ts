#!/usr/bin/env node
import { HELP_TEXT, parseCliArguments } from './args.js';
import { resolveDeviceViewport } from './devices.js';
import type { EngineName, EngineStatus } from './protocol.js';
import { startDashboardServer } from './server.js';
import { EngineSession, type SessionEvents } from './session.js';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
    console.log(HELP_TEXT);
    process.exit(argv.length === 0 ? 1 : 0);
  }

  const options = parseCliArguments(argv);
  const viewport = resolveDeviceViewport(options.device);

  const sessions = new Map<EngineName, EngineSession>();
  const server = await startDashboardServer({
    port: options.port,
    sessions,
    hello: () => ({
      type: 'hello',
      url: options.url,
      device: options.device,
      engines: options.engines,
      viewport,
    }),
  });

  const sessionEvents: SessionEvents = {
    onFrame: (engine, jpeg) => server.broadcastFrame(engine, jpeg),
    onConsole: (engine, level, text) =>
      server.broadcastEvent({ type: 'console', engine, level, text, ts: Date.now() }),
    onPageError: (engine, message) =>
      server.broadcastEvent({ type: 'pageerror', engine, message, ts: Date.now() }),
    onRequestFailed: (engine, url, error) =>
      server.broadcastEvent({ type: 'requestfailed', engine, url, error, ts: Date.now() }),
    onHttpError: (engine, url, status) =>
      server.broadcastEvent({ type: 'httperror', engine, url, status, ts: Date.now() }),
    onStatus: (engine: EngineName, status: EngineStatus, detail?: string) =>
      server.broadcastEvent({ type: 'engine-status', engine, status, detail }),
    onNavigation: (engine, url) =>
      server.broadcastEvent({ type: 'navigation', engine, url, ts: Date.now() }),
  };

  console.log(`crosspane dashboard → http://localhost:${server.port}`);
  console.log(
    `target: ${options.url}  device: ${options.device}  engines: ${options.engines.join(', ')}`,
  );

  const launchResults = await Promise.allSettled(
    options.engines.map(async (engine) => {
      const session = await EngineSession.launch(
        engine,
        {
          url: options.url,
          device: options.device,
          injectScriptPath: options.injectScriptPath,
          customUserAgent: options.customUserAgent,
          emulateWebview: options.emulateWebview,
        },
        sessionEvents,
      );
      sessions.set(engine, session);
      console.log(`  ✓ ${engine} ready`);
    }),
  );
  for (const [index, result] of launchResults.entries()) {
    if (result.status === 'rejected') {
      console.error(`  ✗ ${options.engines[index]} failed: ${String(result.reason)}`);
      console.error(
        `    (missing browser? run: pnpm exec playwright install ${options.engines[index]})`,
      );
    }
  }
  if (sessions.size === 0) {
    server.close();
    throw new Error('No engine could be started.');
  }

  const shutdown = async (): Promise<void> => {
    console.log('\nshutting down…');
    await Promise.allSettled([...sessions.values()].map((session) => session.dispose()));
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
