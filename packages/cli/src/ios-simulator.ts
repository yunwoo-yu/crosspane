import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { type CaptureLoop, startCaptureLoop } from './capture-loop.js';
import { ensureSckHelper } from './ios-sck.js';
import type { InputTarget, SessionEvents } from './session.js';
import { createShellCommandChannel } from './shell-command-queue.js';
import { parseShellEvent } from './shell-events.js';

const execFileAsync = promisify(execFile);

const ENGINE = 'ios-sim' as const;
const BOOT_TIMEOUT_MS = 120_000;
// 시뮬레이터 스크린샷은 회당 수백 ms가 걸려 브라우저 엔진보다 느리게 폴링한다
const IDLE_CAPTURE_INTERVAL_MS = 1_500;
const ACTIVE_CAPTURE_INTERVAL_MS = 400;
// 셸 명령 롱폴 유지 시간 — 이 안에 명령이 오면 즉시 응답한다 (지연 0)
const COMMAND_LONG_POLL_MS = 8_000;
const ACTIVITY_WINDOW_MS = 5_000;
const MAX_QUEUED_COMMANDS = 200;

const XCODE_DEVELOPER_DIR = '/Applications/Xcode.app/Contents/Developer';
// idb(옵션): IOSurface 직결 30fps 스트림 — 없으면 셸 takeSnapshot 폴백
const IDB_CANDIDATES = [
  join(homedir(), '.crosspane', 'idb-venv', 'bin', 'idb'),
  '/opt/homebrew/bin/idb',
  join(homedir(), '.local', 'bin', 'idb'),
];
const SHELL_BUNDLE_ID = 'dev.crosspane.shell';

/** 셸앱 Swift 소스 위치 — dist/../shell (모노레포/배포 패키지 동일 상대경로) */
function shellSourceDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../shell');
}

/**
 * WKWebView 셸앱을 컴파일해 캐시한다 (~/.crosspane/shell/<소스해시>).
 * 셸이 있으면 ios-sim pane이 Safari 브라우저가 아니라 진짜 웹뷰 "컴포넌트"가 되고,
 * 콘솔 릴레이와 입력 미러링(클릭/스크롤/타이핑)이 가능해진다.
 */
export async function ensureShellApp(developerDir: string): Promise<string> {
  const sourceDir = shellSourceDir();
  const mainSwift = join(sourceDir, 'main.swift');
  const infoPlist = join(sourceDir, 'Info.plist');
  const source = await readFile(mainSwift, 'utf-8');
  const plist = await readFile(infoPlist, 'utf-8');
  const hash = createHash('sha256').update(source).update(plist).digest('hex').slice(0, 12);

  const appDir = join(homedir(), '.crosspane', 'shell', hash, 'CrosspaneShell.app');
  const binaryPath = join(appDir, 'CrosspaneShell');
  if (existsSync(binaryPath)) return appDir;

  await mkdir(appDir, { recursive: true });
  await copyFile(infoPlist, join(appDir, 'Info.plist'));
  const sdk = await execFileAsync('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-path'], {
    env: { ...process.env, DEVELOPER_DIR: developerDir },
    timeout: 30_000,
  });
  const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
  await execFileAsync(
    'xcrun',
    [
      'swiftc',
      '-sdk',
      sdk.stdout.trim(),
      '-target',
      `${arch}-apple-ios15.0-simulator`,
      mainSwift,
      '-o',
      binaryPath,
    ],
    { env: { ...process.env, DEVELOPER_DIR: developerDir }, timeout: 120_000 },
  );
  return appDir;
}

interface SimctlDevice {
  udid: string;
  name: string;
  state: string;
  isAvailable: boolean;
}

/** xcode-select가 CLT를 가리켜도 Xcode.app이 있으면 DEVELOPER_DIR로 우회한다. macOS 전용 */
export function resolveDeveloperDir(): string | undefined {
  if (process.platform !== 'darwin') return undefined;
  if (process.env.DEVELOPER_DIR) return process.env.DEVELOPER_DIR;
  return existsSync(XCODE_DEVELOPER_DIR) ? XCODE_DEVELOPER_DIR : undefined;
}

/**
 * `simctl list devices available -j` 출력에서 부팅할 기기를 고른다.
 * 이미 부팅된 기기 > 최신 iOS 런타임의 iPhone 순으로 선호한다.
 */
export function chooseSimulatorDevice(
  simctlListJson: string,
  preferredRuntime?: string,
): { udid: string; name: string; runtime: string } | undefined {
  const parsed = JSON.parse(simctlListJson) as { devices: Record<string, SimctlDevice[]> };
  // "17.2" → "iOS-17-2" 형태로 정규화
  const wanted = preferredRuntime ? `iOS-${preferredRuntime.replace(/\./g, '-')}` : undefined;
  const candidates: { udid: string; name: string; runtime: string; booted: boolean }[] = [];
  for (const [runtimeId, devices] of Object.entries(parsed.devices)) {
    const runtime = runtimeId.replace('com.apple.CoreSimulator.SimRuntime.', '');
    if (!runtime.startsWith('iOS')) continue;
    if (wanted && runtime !== wanted) continue;
    for (const device of devices) {
      if (!device.isAvailable || !device.name.startsWith('iPhone')) continue;
      candidates.push({
        udid: device.udid,
        name: device.name,
        runtime,
        booted: device.state === 'Booted',
      });
    }
  }
  candidates.sort((a, b) => {
    if (a.booted !== b.booted) return a.booted ? -1 : 1;
    return b.runtime.localeCompare(a.runtime, undefined, { numeric: true });
  });
  return candidates[0];
}

/** 설치된 iOS 런타임 버전 목록 (에러 안내용) */
export function listIosRuntimes(simctlListJson: string): string[] {
  const parsed = JSON.parse(simctlListJson) as { devices: Record<string, SimctlDevice[]> };
  return Object.keys(parsed.devices)
    .map((id) => id.replace('com.apple.CoreSimulator.SimRuntime.', ''))
    .filter((runtime) => runtime.startsWith('iOS'))
    .map((runtime) => runtime.replace('iOS-', '').replace(/-/g, '.'))
    .sort();
}

/**
 * 실제 iOS 시뮬레이터 pane — 진짜 Apple iOS 빌드의 Safari/WebKit이 렌더링한다.
 * 에뮬레이션이 아닌 실환경 검증용. 입력 주입 채널이 없어 view-only이며,
 * navigate/reload 커맨드만 따라간다 (재동기화 버튼 포함).
 */
export class IosSimulatorSession implements InputTarget {
  private activeUntil = 0;
  private lastFrame: Buffer | null = null;
  private currentUrl: string;
  /** shell = 진짜 WKWebView 컴포넌트 + 입력/콘솔 지원, safari = 브라우저 view-only 폴백 */
  private mode: 'shell' | 'safari' = 'safari';
  private readonly commandChannel = createShellCommandChannel({
    longPollMs: COMMAND_LONG_POLL_MS,
    maxQueued: MAX_QUEUED_COMMANDS,
    onEnqueue: () => this.markActivity(),
  });
  private captureLoop: CaptureLoop | null = null;
  private viewersActive = true;
  private videoProcess: ReturnType<typeof import('node:child_process').spawn> | null = null;
  private videoChunkHandler: ((chunk: Buffer) => void) | null = null;
  private stoppedVideo = false;
  private events: SessionEvents | null = null;

  private constructor(
    private readonly udid: string,
    private readonly developerDir: string,
    initialUrl: string,
  ) {
    this.currentUrl = initialUrl;
  }

  static async launch(
    url: string,
    events: SessionEvents,
    options: { runtime?: string; controlUrl?: string } = {},
  ): Promise<IosSimulatorSession> {
    events.onStatus(ENGINE, 'starting');
    const developerDir = resolveDeveloperDir();
    if (!developerDir) {
      throw new Error('iOS Simulator pane requires macOS with Xcode.app installed');
    }

    const list = await simctl(developerDir, ['list', 'devices', 'available', '-j']);
    const device = chooseSimulatorDevice(list.stdout, options.runtime);
    if (!device) {
      const runtimes = listIosRuntimes(list.stdout).join(', ');
      throw new Error(
        options.runtime
          ? `No iPhone simulator for iOS ${options.runtime} (installed: ${runtimes})`
          : 'No available iPhone simulator found',
      );
    }

    // 이미 부팅돼 있으면 boot가 149를 반환한다 — 무시
    await simctl(developerDir, ['boot', device.udid]).catch(() => undefined);
    await simctl(developerDir, ['bootstatus', device.udid, '-b'], BOOT_TIMEOUT_MS);

    const session = new IosSimulatorSession(device.udid, developerDir, url);
    session.events = events;
    const runtimeLabel = device.runtime.replace(/-/g, ' ');

    // 1순위: WKWebView 셸앱 (컴포넌트 레벨 + 입력/콘솔). 실패 시 Safari view-only 폴백
    if (options.controlUrl) {
      try {
        const appDir = await ensureShellApp(developerDir);
        // 부팅 직후엔 install이 일시 실패할 수 있다 (실측: 외부 shutdown 후 재부팅 레이스)
        for (let attempt = 0; ; attempt++) {
          try {
            await simctl(developerDir, ['install', device.udid, appDir]);
            break;
          } catch (err) {
            if (attempt >= 3) throw err;
            await new Promise((resolve) => setTimeout(resolve, 3_000));
          }
        }
        await simctl(developerDir, ['terminate', device.udid, SHELL_BUNDLE_ID]).catch(
          () => undefined,
        );
        await execFileAsync('xcrun', ['simctl', 'launch', device.udid, SHELL_BUNDLE_ID], {
          env: {
            ...process.env,
            DEVELOPER_DIR: developerDir,
            SIMCTL_CHILD_CROSSPANE_URL: url,
            SIMCTL_CHILD_CROSSPANE_CONTROL: options.controlUrl,
          },
          timeout: 60_000,
        });
        session.mode = 'shell';
        session.shellControlUrl = options.controlUrl;
        // 셸 모드는 입력 미러링이 가능하다 — view-only 해제
        events.onStatus(ENGINE, 'ready', `${device.name} · WKWebView (${runtimeLabel})`, false);
        session.startPolling(events);
        session.startShellWatchdog();
        return session;
      } catch (err) {
        // 셸 빌드/설치 실패 — Safari 폴백으로 계속하되, 이유를 남겨야
        // "왜 view-only지?"를 진단할 수 있다
        const reason = err instanceof Error ? err.message : String(err);
        console.warn(
          `  ⚠ ios-sim: WKWebView shell failed → falling back to Safari (view-only): ${reason}`,
        );
        events.onConsole(
          ENGINE,
          'warning',
          `[crosspane] WKWebView shell failed (${reason}) — running Safari view-only`,
        );
      }
    }

    // 헤드리스 부팅 직후에는 openurl이 타임아웃된다 —
    // Safari를 먼저 실행해두면 openurl이 기존 프로세스로 전달돼 즉시 성공한다
    await simctl(developerDir, ['launch', device.udid, 'com.apple.mobilesafari']).catch(
      () => undefined,
    );
    await session.openUrl(url);
    events.onStatus(ENGINE, 'ready', `${device.name} · Safari (${runtimeLabel})`);
    events.onNavigation(ENGINE, url);
    session.startPolling(events);
    return session;
  }

  private shellFrameCount = 0;

  /**
   * 셸이 자체 캡처(takeSnapshot)해 push한 프레임 — simctl 스크린샷(회당 수백 ms)을
   * 대체하는 ~15fps 스트림. 안정적으로 흐르기 시작하면 simctl 폴링을 중단한다.
   * scrollY는 프레임 픽셀 단위 — 대시보드 로컬 에코가 iOS pane에도 걸린다.
   */
  handleShellFrame(jpeg: Buffer, scrollY: number): void {
    if (jpeg.length === 0) return;
    this.shellFrameCount += 1;
    if (this.shellFrameCount > 10) this.captureLoop?.stop();
    // markActivity()는 입력 경로 전용 — 프레임 수신을 활동으로 치면 셸이 유휴에도
    // 프레임을 밀 때 세션이 영구 active가 돼, 폴링 폴백이 재기동된 뒤 유휴에도
    // 활성 주기(400ms)로 돈다
    this.events?.onFrame(ENGINE, jpeg, scrollY);
  }

  /** 셸앱이 POST한 이벤트(콘솔/에러/내비게이션)를 세션 이벤트로 변환 */
  handleShellEvent(payload: unknown): void {
    if (!this.events) return;
    const event = parseShellEvent(payload);
    if (!event) return;
    if (event.kind === 'console') this.events.onConsole(ENGINE, event.level, event.text);
    else if (event.kind === 'pageerror') this.events.onPageError(ENGINE, event.text);
    else if (event.url !== this.currentUrl) {
      // 같은 URL 중복 내비게이션 억제 — 에러 배지 구간이 매번 리셋되지 않게
      this.currentUrl = event.url;
      this.events.onNavigation(ENGINE, event.url);
    }
  }

  private enqueue(command: Record<string, unknown>): void {
    this.commandChannel.enqueue(command);
  }

  /** 셸의 명령 롱폴 — 규약 구현은 shell-command-queue.ts (Android와 공유) */
  waitForShellCommands(): Promise<unknown[]> {
    // 셸 생존 신호 — 유휴에도 ~8초마다 재폴링하므로 끊기면 셸이 죽은 것이다
    // (프레임 부재는 정적 화면과 구분이 안 돼 생존 신호로 못 쓴다)
    this.lastShellPollAt = Date.now();
    if (this.shellStallFallbackActive) {
      this.shellStallFallbackActive = false;
      console.log(
        '  ▶ ios-sim: 셸 폴링 복귀 — 스크린샷 폴백 해제 예정 (셸 프레임이 재개되면 자동)',
      );
    }
    return this.commandChannel.waitForCommands();
  }

  private lastShellPollAt = 0;
  private shellWatchdogTimer: NodeJS.Timeout | null = null;
  private shellStallFallbackActive = false;
  private shellRelaunching = false;
  private shellControlUrl: string | undefined;

  /**
   * 셸 생존 감시 — 셸앱이 크래시하면 프레임도 입력도 조용히 죽는데,
   * 프레임 스트림 확립 후에는 captureLoop가 멈춰 있어 pane이 영구히 굳는다.
   * 롱폴 신호가 끊기면 셸을 재실행하고, 그동안 simctl 스크린샷 폴링으로
   * 화면을 유지한다 (SCK가 살아 있으면 화면은 SCK 담당이라 폴백 불필요).
   */
  startShellWatchdog(): void {
    this.shellWatchdogTimer = setInterval(() => {
      if (this.stoppedVideo) return;
      const stalled = this.lastShellPollAt > 0 && Date.now() - this.lastShellPollAt > 25_000;
      if (!stalled || this.shellRelaunching) return;
      console.warn('  ⚠ ios-sim: shell polling went silent — relaunching shell');
      if (!this.sckProcess && !this.shellStallFallbackActive) {
        this.shellStallFallbackActive = true;
        this.captureLoop?.stop();
        if (this.events) this.startPolling(this.events);
      }
      this.shellRelaunching = true;
      void this.relaunchShell().finally(() => {
        this.shellRelaunching = false;
        this.lastShellPollAt = Date.now(); // 재실행 직후 판정 유예
      });
    }, 10_000);
  }

  private async relaunchShell(): Promise<void> {
    if (!this.shellControlUrl) return;
    try {
      await simctl(this.developerDir, ['terminate', this.udid, SHELL_BUNDLE_ID]).catch(
        () => undefined,
      );
      await execFileAsync('xcrun', ['simctl', 'launch', this.udid, SHELL_BUNDLE_ID], {
        env: {
          ...process.env,
          DEVELOPER_DIR: this.developerDir,
          SIMCTL_CHILD_CROSSPANE_URL: this.currentUrl,
          SIMCTL_CHILD_CROSSPANE_CONTROL: this.shellControlUrl,
        },
        timeout: 60_000,
      });
      console.log('  ▶ ios-sim: shell relaunched');
    } catch (err) {
      console.warn(
        `  ⚠ ios-sim: 셸 재실행 실패 — 다음 감시 주기에 재시도 (${String(err).slice(0, 80)})`,
      );
    }
  }

  /**
   * 부팅 직후에는 스프링보드가 아직 안정되지 않아 openurl이 타임아웃으로
   * 실패할 수 있다 — 간격을 두고 재시도한다.
   */
  private async openUrl(url: string, attempts = 4): Promise<void> {
    this.currentUrl = url;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        await simctl(this.developerDir, ['openurl', this.udid, url], 90_000);
        return;
      } catch (err) {
        if (attempt === attempts) throw err;
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
    }
  }

  private startPolling(events: SessionEvents): void {
    this.captureLoop = startCaptureLoop({
      capture: () => this.captureAndEmitFrame(events),
      isActive: () => Date.now() < this.activeUntil,
      shouldCapture: () => this.viewersActive,
      activeIntervalMs: ACTIVE_CAPTURE_INTERVAL_MS,
      idleIntervalMs: IDLE_CAPTURE_INTERVAL_MS,
    });
  }

  private async captureAndEmitFrame(events: SessionEvents): Promise<void> {
    const screenshotPath = join(tmpdir(), `crosspane-sim-${this.udid}.jpeg`);
    try {
      await simctl(this.developerDir, [
        'io',
        this.udid,
        'screenshot',
        '--type=jpeg',
        screenshotPath,
      ]);
      const jpeg = await readFile(screenshotPath);
      if (this.lastFrame?.equals(jpeg)) return;
      this.lastFrame = jpeg;
      // 시뮬레이터는 페이지 스크롤 위치를 알 수 없다 (로컬 에코 미적용 대상)
      events.onFrame(ENGINE, jpeg, -1);
    } catch {
      // 부팅 직후/일시적 실패 — 루프 유지
    } finally {
      await rm(screenshotPath, { force: true }).catch(() => undefined);
    }
  }

  markActivity(): void {
    this.activeUntil = Date.now() + ACTIVITY_WINDOW_MS;
    // 입력 직후 즉시 캡처 — 화면 반영 지연이 폴링 간격만큼 늘어지는 것을 막는다
    this.captureLoop?.wake();
  }

  setViewersActive(active: boolean): void {
    if (this.viewersActive === active) return; // 접속/watch마다 반복 유입 — 동일값이면 무시
    this.viewersActive = active;
    if (active) {
      this.captureLoop?.wake();
      if (this.videoChunkHandler && !this.videoProcess) this.spawnVideoStream();
      // 시청자 복귀: 셸 스냅샷을 먼저 되살려 즉시 화면을 채우고, SCK가 재부착되면
      // 다시 pauseFrames로 넘겨받는다 (사망 복구 경로와 동일한 핸드오프)
      if (this.sckPausedForNoViewers) {
        this.sckPausedForNoViewers = false;
        this.enqueue({ type: 'resumeFrames' });
        void this.startSckStream();
      }
    } else {
      if (this.videoProcess) {
        const proc = this.videoProcess;
        this.videoProcess = null;
        proc.kill('SIGKILL');
      }
      // 시청자 0명이면 SCK 30fps 캡처도 낭비다 — 의도적 정지로 표시해
      // exit 핸들러가 폴백 재생/재시도를 걸지 않게 한다
      if (this.sckProcess) {
        this.sckPausedForNoViewers = true;
        this.sckProcess.kill('SIGKILL');
      }
    }
  }

  /**
   * iOS 화면 소스 트레이드오프 (전부 실측):
   * - 셸 takeSnapshot(기본): 프레임 독립이라 깨짐 0, ~5fps
   * - idb H.264 (CROSSPANE_IOS_H264=1 옵트인): 20fps지만 델타 손상 시 잔상이 남고
   *   idb가 주기적 IDR을 안 보내 복구 불가 (지직거림 실측)
   * - idb MJPEG: 무결점이지만 인코딩이 느려 3fps — 셸보다 못해 채택 안 함
   */
  startVideoStream(onChunk: (chunk: Buffer) => void): void {
    if (process.env.CROSSPANE_IOS_H264 === '1') {
      const idb = IDB_CANDIDATES.find((path) => existsSync(path));
      if (idb) {
        this.videoChunkHandler = onChunk;
        this.spawnVideoStream(idb);
        return;
      }
    }
    // 기본: SCK 창 캡처 (30fps 무결점 JPEG) — 실패(권한/창 없음) 시 셸 스냅샷 유지
    void this.startSckStream();
  }

  private sckProcess: ReturnType<typeof spawn> | null = null;
  private jpegBuffer: Buffer = Buffer.alloc(0);

  private sckRetries = 0;
  private sckWarned = false;
  private sckRetryTimer: NodeJS.Timeout | null = null;
  /** 시청자 0명이라 SCK를 의도적으로 멈춘 상태 — 사망 복구(폴백/재시도)와 구분한다 */
  private sckPausedForNoViewers = false;

  private async startSckStream(): Promise<void> {
    // dispose 이후 예약돼 있던 재시도가 세션을 되살리지 않게 (stopped pane 프레임 유출 방지)
    if (this.stoppedVideo) return;
    try {
      const helper = await ensureSckHelper();
      // 베젤 아트가 켜져 있으면 창에 타이틀바+베젤이 섞여 고정비 크롭이 어긋난다
      // (실측: 검은 테두리 프레임 + 클릭 좌표 오프셋) — 화면만 그리도록 끈다
      if (this.sckRetries === 0) {
        const chrome = await execFileAsync('defaults', [
          'read',
          'com.apple.iphonesimulator',
          'ShowChrome',
        ]).catch(() => ({ stdout: '1' }));
        if (chrome.stdout.trim() !== '0') {
          await execFileAsync('defaults', [
            'write',
            'com.apple.iphonesimulator',
            'ShowChrome',
            '-bool',
            'false',
          ]).catch(() => undefined);
          // 주의: killall Simulator는 부팅된 기기까지 내려 셸 앱이 증발한다 (실측) —
          // 이미 떠 있으면 재시작하지 않고 다음 Simulator 실행부터 적용되게만 한다
          const running = await execFileAsync('pgrep', ['-x', 'Simulator']).then(
            () => true,
            () => false,
          );
          if (running) {
            console.log(
              '  ℹ ios-sim: 시뮬레이터 베젤 표시를 껐습니다 — 다음 Simulator 실행부터 캡처 크롭이 정합됩니다',
            );
          } else {
            console.log('  ℹ ios-sim: hiding simulator bezel (keeps window-capture crop aligned)');
          }
        }
      }
      // 시뮬레이터 창을 화면에 노출 (SCK는 창이 보여야 캡처 가능).
      // -g: 백그라운드로 열어 포커스를 뺏지 않는다 — 매 재시도마다 안전
      // (open 생략 시 Simulator.app이 없으면 SCK가 영원히 못 붙는다 — 실측)
      await execFileAsync('open', ['-g', '-a', 'Simulator'], {
        env: { ...process.env, DEVELOPER_DIR: this.developerDir },
        timeout: 30_000,
      }).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 4_000)); // 창 렌더 대기
      // 비동기 준비(빌드/open/대기) 중 상태가 바뀌었으면 spawn하지 않는다
      if (this.stoppedVideo || this.sckPausedForNoViewers) return;
      const viewport = '0.4613'; // iPhone 세로 화면비(w/h) 근사 — 타이틀바 크롭용
      const proc = spawn(helper, [viewport], { stdio: ['ignore', 'pipe', 'pipe'] });
      this.sckProcess = proc;
      let sawFrame = false;
      // TCC 승인 대기 등으로 무한 행 — 첫 프레임이 없으면 정리하고 재시도/안내
      const watchdog = setTimeout(() => {
        if (!sawFrame) {
          if (!this.sckWarned) {
            this.sckWarned = true;
            console.warn(
              '  ⚠ ios-sim: SCK 캡처가 시작되지 않습니다 — 시스템 설정 → 개인정보 보호 → 화면 기록에서 터미널을 허용하면 자동으로 활성됩니다 (셸 스냅샷으로 계속, 10초마다 재시도)',
            );
          }
          proc.kill('SIGKILL');
        }
      }, 12_000);
      proc.stdout?.on('data', (chunk: Buffer) => {
        if (!sawFrame) {
          sawFrame = true;
          clearTimeout(watchdog);
          console.log('  ▶ ios-sim: SCK window capture active (30fps)');
          this.enqueue({ type: 'pauseFrames' });
          this.captureLoop?.stop();
        }
        this.consumeJpegStream(chunk);
      });
      proc.stderr?.on('data', (data: Buffer) => {
        const message = String(data);
        if (message.includes('TCC') || message.includes('sck-error')) {
          console.warn(
            '  ⚠ ios-sim: 화면 기록 권한이 없어 SCK 30fps를 못 씁니다 — 시스템 설정 → 개인정보 보호 → 화면 기록에서 터미널을 허용하면 다음 실행부터 활성됩니다 (셸 스냅샷으로 계속)',
          );
        }
      });
      proc.on('exit', () => {
        clearTimeout(watchdog);
        if (this.sckProcess === proc) this.sckProcess = null;
        if (this.stoppedVideo) return;
        // 시청자 0명으로 인한 의도적 정지 — 폴백 재생도 재시도도 하지 않는다
        // (복귀는 setViewersActive(true)가 담당)
        if (this.sckPausedForNoViewers) return;
        if (sawFrame) {
          // 세션 도중 사망(Simulator 창 닫힘 등) — 붙을 때 셸 프레임을 pause했으므로
          // 되살리지 않으면 pane이 마지막 SCK 프레임에서 굳는다
          console.warn(
            '  ⚠ ios-sim: SCK capture died — falling back to shell snapshots, retrying every 10s',
          );
          this.enqueue({ type: 'resumeFrames' });
          if (this.events) this.startPolling(this.events);
        }
        // 초기 창 레이스든 TCC 미승인이든 세션 도중 사망이든 — 무한 재시도해
        // 나중에 권한 허용/창 복구 시 재실행 없이 자동 활성되게 한다
        this.sckRetries += 1;
        this.sckRetryTimer = setTimeout(() => void this.startSckStream(), 10_000);
      });
    } catch (err) {
      console.warn(
        `  ⚠ ios-sim: SCK 헬퍼 빌드 실패 — 셸 스냅샷 유지 (${String(err).slice(0, 120)})`,
      );
    }
  }

  /** SCK 헬퍼의 JPEG 연속 스트림(FFD8…FFD9)을 프레임으로 분리한다 */
  private consumeJpegStream(chunk: Buffer): void {
    // dispose/의도적 정지 후 도착한 잔여 청크가 프레임으로 흘러가지 않게
    if (this.stoppedVideo || this.sckPausedForNoViewers) return;
    this.jpegBuffer = Buffer.concat([this.jpegBuffer, chunk]);
    while (true) {
      const start = this.jpegBuffer.indexOf(Buffer.from([0xff, 0xd8]));
      if (start < 0) {
        this.jpegBuffer = Buffer.alloc(0);
        return;
      }
      const end = this.jpegBuffer.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
      if (end < 0) {
        if (start > 0) this.jpegBuffer = this.jpegBuffer.subarray(start);
        return;
      }
      const jpeg = Buffer.from(this.jpegBuffer.subarray(start, end + 2));
      this.jpegBuffer = this.jpegBuffer.subarray(end + 2);
      this.events?.onFrame(ENGINE, jpeg, -1);
    }
  }

  restartVideoStream(): void {
    if (this.videoChunkHandler && this.videoProcess) this.videoProcess.kill('SIGKILL');
  }

  private spawnVideoStream(idbPath?: string): void {
    const idb = idbPath ?? IDB_CANDIDATES.find((path) => existsSync(path));
    if (this.stoppedVideo || !this.videoChunkHandler || !idb) return;
    const proc = spawn(
      idb,
      ['video-stream', '--udid', this.udid, '--fps', '30', '--format', 'h264'],
      {
        // PYTHONUNBUFFERED 필수 — 파이썬 stdout 블록 버퍼링(64KB)이 프레임을 묶어
        // 초 단위 지연을 만든다 (실측: 60KB 덩어리 2개/드래그)
        env: { ...process.env, DEVELOPER_DIR: this.developerDir, PYTHONUNBUFFERED: '1' },
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    this.videoProcess = proc;
    let sawData = false;
    proc.stdout?.on('data', (chunk: Buffer) => {
      if (!sawData) {
        sawData = true;
        // 실스트림 확보 — 셸의 스냅샷 프레임 스트리밍을 중지시킨다 (CPU 절약 + 소스 단일화)
        this.enqueue({ type: 'pauseFrames' });
        this.captureLoop?.stop();
      }
      this.videoChunkHandler?.(chunk);
    });
    proc.on('error', () => undefined);
    proc.on('exit', () => {
      if (!this.stoppedVideo && this.viewersActive && this.videoProcess === proc) {
        setTimeout(() => this.spawnVideoStream(), 400);
      }
    });
  }

  async navigate(url: string): Promise<void> {
    this.currentUrl = url;
    if (this.mode === 'shell') {
      this.enqueue({ type: 'navigate', url });
      return;
    }
    await this.openUrl(url);
  }

  async reload(): Promise<void> {
    if (this.mode === 'shell') {
      this.enqueue({ type: 'reload' });
      return;
    }
    await this.openUrl(this.currentUrl);
  }

  // 셸 모드면 명령 큐로 미러링, Safari 폴백이면 view-only(no-op)
  async clickAt(normalizedX: number, normalizedY: number): Promise<void> {
    if (this.mode === 'shell') this.enqueue({ type: 'click', x: normalizedX, y: normalizedY });
  }
  async dragBetween(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    durationMs: number,
  ): Promise<void> {
    if (this.mode === 'shell') {
      this.enqueue({ type: 'drag', fromX, fromY, toX, toY, durationMs });
    }
  }
  async scrollBy(deltaY: number): Promise<void> {
    if (this.mode === 'shell') this.enqueue({ type: 'scroll', deltaY });
  }
  async pressKey(key: string): Promise<void> {
    if (this.mode === 'shell') this.enqueue({ type: 'keypress', key });
  }
  async typeText(text: string): Promise<void> {
    if (this.mode === 'shell') this.enqueue({ type: 'type', text });
  }
  async goBack(): Promise<void> {
    if (this.mode === 'shell') this.enqueue({ type: 'back' });
  }
  async goForward(): Promise<void> {
    if (this.mode === 'shell') this.enqueue({ type: 'forward' });
  }

  async dispose(): Promise<void> {
    this.stoppedVideo = true;
    if (this.sckRetryTimer) clearTimeout(this.sckRetryTimer);
    this.sckRetryTimer = null;
    if (this.shellWatchdogTimer) clearInterval(this.shellWatchdogTimer);
    this.shellWatchdogTimer = null;
    this.sckProcess?.kill('SIGKILL');
    this.videoProcess?.kill('SIGKILL');
    this.captureLoop?.stop();
    this.commandChannel.dispose();
    // 다음 실행이 빨라지도록 시뮬레이터는 부팅 상태로 둔다
  }
}

function simctl(
  developerDir: string,
  args: string[],
  timeoutMs = 30_000,
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('xcrun', ['simctl', ...args], {
    env: { ...process.env, DEVELOPER_DIR: developerDir },
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
}
