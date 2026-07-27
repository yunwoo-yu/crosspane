#!/usr/bin/env node
import { AndroidEmulatorSession, resolveAndroidSdkDir } from './android-emulator.js';
import { HELP_TEXT, parseCliArguments } from './args.js';
import { resolveDeviceViewport } from './devices.js';
import { applyInteractiveAnswers, detectMissingSetup, runInteractiveSetup } from './interactive.js';
import { IosSimulatorSession, resolveDeveloperDir } from './ios-simulator.js';
import { resolvePaneSetup } from './pane-setup.js';
import type { BrowserEngineName, EngineName, EngineStatus } from './protocol.js';
import { startDashboardServer } from './server.js';
import { EngineSession, type InputTarget, type SessionEvents } from './session.js';

async function main(): Promise<void> {
  let argv = process.argv.slice(2);
  if (argv.includes('-h') || argv.includes('--help')) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  // 터미널에서 직접 실행하고 대상/프로필/포트가 명시되지 않았으면 물어본다.
  // 플래그를 주면 그대로 스킵되고, 파이프/CI(non-TTY)에서는 기본값으로 동작한다.
  const missing = detectMissingSetup(argv);
  const isInteractiveTerminal = process.stdin.isTTY === true && process.stdout.isTTY === true;
  if (isInteractiveTerminal && (missing.target || missing.profile || missing.port)) {
    argv = applyInteractiveAnswers(argv, await runInteractiveSetup(missing));
  } else if (argv.length === 0) {
    console.log(HELP_TEXT);
    process.exit(1);
  }

  const options = parseCliArguments(argv);
  const viewport = resolveDeviceViewport(options.device);

  // 실기기 pane 가용성 — 없으면 pane 자체를 빼고 이유를 안내한다
  const iosAvailable = resolveDeveloperDir() !== undefined;
  const androidAvailable = resolveAndroidSdkDir() !== undefined;
  if (options.iosSimulator === true && !iosAvailable) {
    console.warn('  ⚠ --ios-sim ignored: requires macOS with Xcode.app installed');
  }
  if (options.android === true && !androidAvailable) {
    console.warn(
      '  ⚠ --android ignored: Android SDK not found (set ANDROID_HOME or install Android Studio)',
    );
  }

  const paneSetup = resolvePaneSetup({
    autoStartEngines: options.engines,
    autoStartRealDevices: options.autoStartRealDevices,
    iosSimulator: options.iosSimulator,
    android: options.android,
    iosAvailable,
    androidAvailable,
  });

  const sessions = new Map<EngineName, InputTarget>();
  const startingEngines = new Set<EngineName>();

  const browserLaunchOptions = {
    url: options.url,
    device: options.device,
    injectScriptPath: options.injectScriptPath,
    customUserAgent: options.customUserAgent,
    emulateWebview: options.emulateWebview,
    freshSession: options.freshSession,
  };

  /** pane 라이프사이클 컨트롤러 — 기동 시 자동 시작과 대시보드의 start/stop이 공유 */
  const paneController = {
    async startEngine(engine: EngineName): Promise<void> {
      if (!paneSetup.panes.includes(engine)) return;
      if (sessions.has(engine) || startingEngines.has(engine)) return;
      startingEngines.add(engine);
      try {
        let session: InputTarget;
        if (engine === 'android') {
          session = await AndroidEmulatorSession.launch(options.url, sessionEvents);
        } else if (engine === 'ios-sim') {
          session = await IosSimulatorSession.launch(options.url, sessionEvents, {
            runtime: options.iosRuntime,
            controlUrl: `http://localhost:${server.port}/shell/ios-sim`,
          });
        } else {
          session = await EngineSession.launch(
            engine as BrowserEngineName,
            browserLaunchOptions,
            sessionEvents,
          );
        }
        sessions.set(engine, session);
        console.log(`  ✓ ${engine} ready`);
      } catch (err) {
        sessionEvents.onStatus(engine, 'error', String(err));
        console.error(`  ✗ ${engine} failed: ${String(err)}`);
        if (engine !== 'android' && engine !== 'ios-sim') {
          console.error(`    (missing browser? run: npx playwright install ${engine})`);
        }
      } finally {
        startingEngines.delete(engine);
      }
    },
    async stopEngine(engine: EngineName): Promise<void> {
      const session = sessions.get(engine);
      if (!session) return;
      sessions.delete(engine);
      sessionEvents.onStatus(engine, 'stopped');
      console.log(`  ■ ${engine} stopped`);
      await session.dispose().catch(() => undefined);
    },
  };

  const server = await startDashboardServer({
    port: options.port,
    sessions,
    paneController,
    // 시뮬레이터 셸앱 브릿지 — 세션이 셸 모드일 때만 실동작한다
    shellBridge: {
      drainCommands(engine) {
        const session = sessions.get(engine);
        return session instanceof IosSimulatorSession ? session.drainShellCommands() : [];
      },
      handleEvent(engine, payload) {
        const session = sessions.get(engine);
        if (session instanceof IosSimulatorSession) session.handleShellEvent(payload);
      },
    },
    hello: () => ({
      type: 'hello',
      url: options.url,
      device: options.device,
      engines: paneSetup.panes,
      viewOnlyEngines: paneSetup.viewOnly.length > 0 ? paneSetup.viewOnly : undefined,
      viewport,
    }),
  });

  const sessionEvents: SessionEvents = {
    onFrame: (engine, jpeg, scrollY) => server.broadcastFrame(engine, jpeg, scrollY),
    onConsole: (engine, level, text) =>
      server.broadcastEvent({ type: 'console', engine, level, text, ts: Date.now() }),
    onPageError: (engine, message) =>
      server.broadcastEvent({ type: 'pageerror', engine, message, ts: Date.now() }),
    onRequestFailed: (engine, url, error) =>
      server.broadcastEvent({ type: 'requestfailed', engine, url, error, ts: Date.now() }),
    onHttpError: (engine, url, status) =>
      server.broadcastEvent({ type: 'httperror', engine, url, status, ts: Date.now() }),
    onNetwork: (engine, entry) =>
      server.broadcastEvent({ type: 'network', engine, ...entry, ts: Date.now() }),
    onStatus: (engine: EngineName, status: EngineStatus, detail?: string, viewOnly?: boolean) =>
      server.broadcastEvent({ type: 'engine-status', engine, status, detail, viewOnly }),
    onNavigation: (engine, url) =>
      server.broadcastEvent({ type: 'navigation', engine, url, ts: Date.now() }),
  };

  console.log(`crosspane dashboard → http://localhost:${server.port}`);
  console.log(
    `target: ${options.url}  device: ${options.device}  panes: ${paneSetup.panes.join(', ')}  auto-start: ${paneSetup.autoStart.join(', ')}`,
  );

  // 자동 시작 대상은 병렬 기동, 나머지는 stopped로 표시 (대시보드에서 시작 가능)
  for (const engine of paneSetup.panes) {
    if (paneSetup.autoStart.includes(engine)) {
      void paneController.startEngine(engine);
    } else {
      sessionEvents.onStatus(engine, 'stopped');
    }
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
