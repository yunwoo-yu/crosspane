#!/usr/bin/env node
import { AndroidEmulatorSession, resolveAndroidSdkDir } from './android-emulator.js';
import { HELP_TEXT, parseCliArguments } from './args.js';
import { resolveDeviceViewport } from './devices.js';
import { applyInteractiveAnswers, detectMissingSetup, runInteractiveSetup } from './interactive.js';
import { IosSimulatorSession, resolveDeveloperDir } from './ios-simulator.js';
import type { EngineName, EngineStatus } from './protocol.js';
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

  // 실기기 pane 가용성: OS/SDK에 따라 다르다. 없으면 조용히 죽는 대신
  // 이유를 알려주고, 코어 엔진 pane은 어떤 환경에서든 항상 동작한다.
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
  if (options.iosSimulator === undefined && !iosAvailable) {
    console.log('  ℹ ios-sim pane skipped — requires macOS with Xcode');
  }
  if (options.android === undefined && !androidAvailable) {
    console.log(
      '  ℹ android pane skipped — Android SDK not found (set ANDROID_HOME or install Android Studio)',
    );
  }
  const useIosSimulator = (options.iosSimulator ?? true) && iosAvailable;
  const useAndroid = (options.android ?? true) && androidAvailable;
  const paneEngines: EngineName[] = [
    ...options.engines,
    ...(useAndroid ? (['android'] as const) : []),
    ...(useIosSimulator ? (['ios-sim'] as const) : []),
  ];
  const sessions = new Map<EngineName, InputTarget>();
  const server = await startDashboardServer({
    port: options.port,
    sessions,
    hello: () => ({
      type: 'hello',
      url: options.url,
      device: options.device,
      engines: paneEngines,
      viewOnlyEngines: useIosSimulator ? ['ios-sim'] : undefined,
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
    onStatus: (engine: EngineName, status: EngineStatus, detail?: string) =>
      server.broadcastEvent({ type: 'engine-status', engine, status, detail }),
    onNavigation: (engine, url) =>
      server.broadcastEvent({ type: 'navigation', engine, url, ts: Date.now() }),
  };

  console.log(`crosspane dashboard → http://localhost:${server.port}`);
  console.log(
    `target: ${options.url}  device: ${options.device}  engines: ${options.engines.join(', ')}`,
  );

  if (useAndroid) {
    // 실제 Android pane — 에뮬레이터 부팅에 시간이 걸릴 수 있어 병렬로 시작.
    // adb input이 있어 탭/스크롤/타이핑까지 완전 미러링된다
    void AndroidEmulatorSession.launch(options.url, sessionEvents)
      .then((session) => {
        sessions.set('android', session);
        console.log('  ✓ android ready (interactive)');
      })
      .catch((err: unknown) => {
        sessionEvents.onStatus('android', 'error', String(err));
        console.error(`  ✗ android failed: ${String(err)}`);
      });
  }

  if (useIosSimulator) {
    // 실제 iOS 시뮬레이터 pane — 부팅에 수십 초 걸릴 수 있어 브라우저 엔진과 병렬로 시작
    void IosSimulatorSession.launch(options.url, sessionEvents)
      .then((session) => {
        sessions.set('ios-sim', session);
        console.log('  ✓ ios-sim ready (view-only)');
      })
      .catch((err: unknown) => {
        sessionEvents.onStatus('ios-sim', 'error', String(err));
        console.error(`  ✗ ios-sim failed: ${String(err)}`);
      });
  }

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
      console.error(`    (missing browser? run: npx playwright install ${options.engines[index]})`);
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
