#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { AndroidEmulatorSession, resolveAndroidSdkDir } from './android-emulator.js';
import { HELP_TEXT, parseCliArguments } from './args.js';
import { resolveDeviceViewport } from './devices.js';
import { hasTargetArgument, promptForTarget } from './interactive.js';
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

  // 인터랙티브로 묻는 건 대상 URL 하나뿐 — pane 구성은 대시보드 토글,
  // 포트는 자동 폴백이 대신한다. 실행 중인 dev 서버가 감지되면 선택지로 제안된다.
  const isInteractiveTerminal = process.stdin.isTTY === true && process.stdout.isTTY === true;
  if (!hasTargetArgument(argv)) {
    if (isInteractiveTerminal) {
      argv = [await promptForTarget(), ...argv];
    } else {
      console.log(HELP_TEXT);
      process.exit(1);
    }
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
    // 명시된 포트는 존중하고, 기본 포트는 사용 중이면 +1씩 폴백
    portAttempts: options.portExplicit ? 1 : 10,
    sessions,
    paneController,
    // 시뮬레이터 셸앱 브릿지 — 세션이 셸 모드일 때만 실동작한다
    shellBridge: {
      waitForCommands(engine) {
        const session = sessions.get(engine);
        return session instanceof IosSimulatorSession
          ? session.waitForShellCommands()
          : Promise.resolve([]);
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

  const dashboardUrl = `http://localhost:${server.port}`;
  console.log(`crosspane dashboard → ${dashboardUrl}`);
  console.log(
    `target: ${options.url}  device: ${options.device}  auto-start: ${paneSetup.autoStart.join(', ')} (나머지 pane은 대시보드 상단 토글로)`,
  );
  // 터미널에서 직접 실행했으면 대시보드를 바로 연다 (파이프/CI에서는 열지 않음)
  if (options.openBrowser && isInteractiveTerminal) openInBrowser(dashboardUrl);

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

/** OS 기본 브라우저로 URL 열기 — 실패해도 조용히 무시 (사용자가 직접 열면 됨) */
function openInBrowser(url: string): void {
  const [command, ...args] =
    process.platform === 'darwin'
      ? ['open', url]
      : process.platform === 'win32'
        ? ['cmd', '/c', 'start', '', url]
        : ['xdg-open', url];
  spawn(command, args, { stdio: 'ignore', detached: true })
    .on('error', () => {})
    .unref();
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
