import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { InputTarget, SessionEvents } from './session.js';

const execFileAsync = promisify(execFile);

const ENGINE = 'ios-sim' as const;
const BOOT_TIMEOUT_MS = 120_000;
// 시뮬레이터 스크린샷은 회당 수백 ms가 걸려 브라우저 엔진보다 느리게 폴링한다
const IDLE_CAPTURE_INTERVAL_MS = 1_500;
const ACTIVE_CAPTURE_INTERVAL_MS = 600;
const ACTIVITY_WINDOW_MS = 5_000;
const MAX_QUEUED_COMMANDS = 200;

const XCODE_DEVELOPER_DIR = '/Applications/Xcode.app/Contents/Developer';
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
  private disposed = false;
  private activeUntil = 0;
  private lastFrame: Buffer | null = null;
  private currentUrl: string;
  /** shell = 진짜 WKWebView 컴포넌트 + 입력/콘솔 지원, safari = 브라우저 view-only 폴백 */
  private mode: 'shell' | 'safari' = 'safari';
  private readonly commandQueue: Record<string, unknown>[] = [];
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
        await simctl(developerDir, ['install', device.udid, appDir]);
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
        // 셸 모드는 입력 미러링이 가능하다 — view-only 해제
        events.onStatus(ENGINE, 'ready', `${device.name} · WKWebView (${runtimeLabel})`, false);
        session.startPolling(events);
        return session;
      } catch {
        // 셸 빌드/설치 실패 — Safari 폴백으로 계속
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

  /** 서버의 /shell 브릿지가 호출 — 셸앱이 폴링으로 가져갈 명령을 드레인 */
  drainShellCommands(): Record<string, unknown>[] {
    return this.commandQueue.splice(0, this.commandQueue.length);
  }

  /** 셸앱이 POST한 이벤트(콘솔/에러/내비게이션)를 세션 이벤트로 변환 */
  handleShellEvent(payload: unknown): void {
    if (!this.events || typeof payload !== 'object' || payload === null) return;
    const event = payload as { kind?: string; level?: string; text?: string; url?: string };
    switch (event.kind) {
      case 'console':
        this.events.onConsole(
          ENGINE,
          event.level === 'warn' ? 'warning' : (event.level ?? 'log'),
          event.text ?? '',
        );
        break;
      case 'pageerror':
        this.events.onPageError(ENGINE, event.text ?? 'unknown error');
        break;
      case 'navigation':
        if (event.url && event.url !== this.currentUrl) {
          this.currentUrl = event.url;
          this.events.onNavigation(ENGINE, event.url);
        }
        break;
      default:
        break;
    }
  }

  private enqueue(command: Record<string, unknown>): void {
    this.commandQueue.push(command);
    // 셸앱이 폴링을 멈춘 상태(크래시 등)에서 입력이 계속 오면 무한 성장한다 — 상한
    if (this.commandQueue.length > MAX_QUEUED_COMMANDS) {
      this.commandQueue.splice(0, this.commandQueue.length - MAX_QUEUED_COMMANDS);
    }
    this.markActivity();
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
    void (async () => {
      while (!this.disposed) {
        await this.captureAndEmitFrame(events);
        const interval =
          Date.now() < this.activeUntil ? ACTIVE_CAPTURE_INTERVAL_MS : IDLE_CAPTURE_INTERVAL_MS;
        await new Promise((resolve) => setTimeout(resolve, interval));
      }
    })();
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
    this.disposed = true;
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
