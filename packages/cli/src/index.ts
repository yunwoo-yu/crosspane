#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { AndroidEmulatorSession, resolveAndroidSdkDir } from './android-emulator.js';
import { cliVersion, HELP_TEXT, parseCliArguments } from './args.js';
import { installPlaywrightBrowser, isMissingBrowserError } from './browser-install.js';
import { resolveDeviceViewport } from './devices.js';
import { hasTargetArgument, probePort, promptForTarget } from './interactive.js';
import { IosSimulatorSession, resolveDeveloperDir } from './ios-simulator.js';
import { resolvePaneSetup } from './pane-setup.js';
import type { BrowserEngineName, EngineName, EngineStatus } from './protocol.js';
import { startDashboardServer } from './server.js';
import { EngineSession, type InputTarget, type SessionEvents } from './session.js';
import { normalizeUrl, planUrlSync } from './url-sync.js';

async function main(): Promise<void> {
  let argv = process.argv.slice(2);
  if (argv.includes('-h') || argv.includes('--help')) {
    console.log(HELP_TEXT);
    process.exit(0);
  }
  // 인터랙티브 프롬프트보다 먼저 처리해야 `crosspane --version`이 URL을 묻지 않는다
  if (argv.includes('-v') || argv.includes('--version')) {
    console.log(cliVersion());
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

  // 대상 서버가 죽어 있으면 pane이 빈 화면이 된다 — 기동 시 미리 알려준다
  const targetPort = /^http:\/\/localhost:(\d+)/.exec(options.url)?.[1];
  if (targetPort && !(await probePort(Number(targetPort)))) {
    console.warn(
      `  ⚠ Cannot reach ${options.url} — make sure your dev server is running (then hit ⟳ in the dashboard)`,
    );
  }

  const sessions = new Map<EngineName, InputTarget>();
  const startingEngines = new Set<EngineName>();
  // 브라우저 자동 설치는 엔진당 1회만 시도 (실패 루프 방지)
  const browserInstallAttempted = new Set<EngineName>();

  // URL 단일 소스: 어긋남은 이유 불문 리더로 계속 수렴한다 (쿨다운으로 루프만 방지)
  const lastNavigationUrl = new Map<EngineName, string>();
  const urlSyncAttempted = new Map<EngineName, { target: string; ts: number }>();
  let urlSyncTimer: NodeJS.Timeout | null = null;
  const URL_SYNC_GRACE_MS = 800;
  const scheduleUrlConvergence = (): void => {
    if (urlSyncTimer) clearTimeout(urlSyncTimer);
    urlSyncTimer = setTimeout(() => {
      urlSyncTimer = null;
      const syncable = [...sessions.keys()].filter(
        (engine) => engine === 'chromium' || engine === 'webkit' || engine === 'firefox',
      );
      const plans = planUrlSync({
        urls: lastNavigationUrl,
        syncable,
        attempted: urlSyncAttempted,
        now: Date.now(),
      });
      for (const plan of plans) {
        urlSyncAttempted.set(plan.engine, { target: normalizeUrl(plan.target), ts: Date.now() });
        console.log(`  ↺ ${plan.engine} converging URL → ${plan.target}`);
        void sessions
          .get(plan.engine)
          ?.navigate(plan.target)
          .catch(() => undefined);
      }
      // 쿨다운으로 미뤄진 어긋남이 남아 있으면 재시도 예약 — 일치할 때까지 계속
      const leaderUrl = lastNavigationUrl.get(syncable[0]);
      const stillDiverged = syncable.some((engine) => {
        const current = lastNavigationUrl.get(engine);
        return (
          leaderUrl !== undefined &&
          current !== undefined &&
          normalizeUrl(current) !== normalizeUrl(leaderUrl)
        );
      });
      if (stillDiverged) scheduleUrlConvergence();
    }, URL_SYNC_GRACE_MS);
  };

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
          session = await AndroidEmulatorSession.launch(options.url, sessionEvents, {
            controlUrl: `http://localhost:${server.port}/shell/android`,
          });
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
        // 실기기는 스크린샷 폴링 대신 진짜 화면 스트림(H.264)을 쓴다
        if (session instanceof AndroidEmulatorSession) {
          session.startVideoStream((chunk) => server.broadcastVideoChunk('android', chunk));
        }
        if (session instanceof IosSimulatorSession) {
          session.startVideoStream((chunk) => server.broadcastVideoChunk('ios-sim', chunk));
        }
        console.log(`  ✓ ${engine} ready`);
      } catch (err) {
        const isBrowserEngine = engine !== 'android' && engine !== 'ios-sim';
        // 첫 실행에서 브라우저가 없으면 안내 대신 그 자리에서 설치하고 재시도한다
        if (isBrowserEngine && isMissingBrowserError(err) && !browserInstallAttempted.has(engine)) {
          browserInstallAttempted.add(engine);
          startingEngines.delete(engine);
          console.log(
            `  ⬇ ${engine} browser not installed — installing now (one-time, tens of MB)…`,
          );
          if (await installPlaywrightBrowser(engine)) {
            return paneController.startEngine(engine);
          }
          console.error(
            `  ✗ ${engine} install failed — install manually: npx playwright install ${engine}`,
          );
        }
        sessionEvents.onStatus(engine, 'error', String(err));
        console.error(`  ✗ ${engine} failed: ${String(err)}`);
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

  if (options.host !== '127.0.0.1' && options.host !== 'localhost') {
    console.warn(
      `  ⚠ Dashboard bound to ${options.host} — anyone who can reach this machine can drive your browser sessions`,
    );
  }
  const server = await startDashboardServer({
    port: options.port,
    host: options.host,
    // 명시된 포트는 존중하고, 기본 포트는 사용 중이면 +1씩 폴백
    portAttempts: options.portExplicit ? 1 : 10,
    sessions,
    paneController,
    // 새 대시보드 접속 → 비디오 스트림을 키프레임부터 재시작 (늦은 접속자 대응)
    onRestartVideo(engine) {
      const session = sessions.get(engine);
      if (session && 'restartVideoStream' in session) {
        (session as AndroidEmulatorSession | IosSimulatorSession).restartVideoStream();
      }
    },
    onClientConnect() {
      for (const session of sessions.values()) {
        if ('restartVideoStream' in session) {
          (session as AndroidEmulatorSession | IosSimulatorSession).restartVideoStream();
        }
      }
    },
    // pane별 시청 신호 — 아무도 안 보는 엔진(포커스 모드의 나머지, 클라이언트 0명 전체)은
    // 캡처/스트림을 멈춘다. 다시 보이면 즉시 재개.
    onWatchedEnginesChange(watched) {
      for (const [engine, session] of sessions) session.setViewersActive?.(watched.has(engine));
    },
    // 시뮬레이터 셸앱 브릿지 — 세션이 셸 모드일 때만 실동작한다
    shellBridge: {
      // iOS/Android 셸 공통 규약 — 셸 프로토콜을 구현한 세션이면 엔진 무관 동작
      waitForCommands(engine) {
        const session = sessions.get(engine);
        return session && 'waitForShellCommands' in session
          ? (session as IosSimulatorSession | AndroidEmulatorSession).waitForShellCommands()
          : Promise.resolve([]);
      },
      handleEvent(engine, payload) {
        const session = sessions.get(engine);
        if (session && 'handleShellEvent' in session) {
          (session as IosSimulatorSession | AndroidEmulatorSession).handleShellEvent(payload);
        }
      },
      handleFrame(engine, jpeg, scrollY) {
        const session = sessions.get(engine);
        if (session instanceof IosSimulatorSession) session.handleShellFrame(jpeg, scrollY);
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
    onFrame: (engine, jpeg, scrollY, flags) => server.broadcastFrame(engine, jpeg, scrollY, flags),
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
    onNavigation: (engine, url) => {
      lastNavigationUrl.set(engine, url);
      if (engine === 'chromium') urlSyncAttempted.clear(); // 리더 이동 — 즉시 재수렴
      scheduleUrlConvergence();
      server.broadcastEvent({ type: 'navigation', engine, url, ts: Date.now() });
    },
  };

  const dashboardUrl = `http://localhost:${server.port}`;
  console.log(`crosspane dashboard → ${dashboardUrl}`);
  console.log(
    `target: ${options.url}  device: ${options.device}  auto-start: ${paneSetup.autoStart.join(', ')} (start the rest from the dashboard toggles)`,
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
