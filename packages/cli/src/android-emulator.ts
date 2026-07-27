import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { InputTarget, SessionEvents } from './session.js';

const execFileAsync = promisify(execFile);

const ENGINE = 'android' as const;
const BOOT_TIMEOUT_MS = 180_000;
// 에뮬레이터 screencap은 회당 수백 ms — 브라우저 엔진보다 느리게 폴링한다
const IDLE_CAPTURE_INTERVAL_MS = 1_500;
const ACTIVE_CAPTURE_INTERVAL_MS = 500;
const ACTIVITY_WINDOW_MS = 5_000;
// 기준 뷰포트(iPhone 15 프리셋 844px) 대비 스와이프 거리 환산에 쓴다
const REFERENCE_VIEWPORT_HEIGHT = 844;

/** Android 키 이벤트 코드 매핑 (adb shell input keyevent) */
export const ANDROID_KEYCODES: Record<string, number> = {
  Enter: 66,
  Backspace: 67,
  Delete: 112,
  Tab: 61,
  Escape: 111,
  ArrowUp: 19,
  ArrowDown: 20,
  ArrowLeft: 21,
  ArrowRight: 22,
  Back: 4, // 실제 Android 뒤로가기 버튼
  Forward: 125,
};

/** ANDROID_HOME/일반 설치 경로에서 SDK 루트를 찾는다 */
export function resolveAndroidSdkDir(): string | undefined {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    join(homedir(), 'Library/Android/sdk'),
    '/opt/homebrew/share/android-commandlinetools',
  ].filter((dir): dir is string => Boolean(dir));
  return candidates.find((dir) => existsSync(join(dir, 'platform-tools/adb')));
}

/** `adb shell wm size` 출력에서 화면 크기를 파싱한다 */
export function parseScreenSize(wmSizeOutput: string): { width: number; height: number } {
  const match = /(\d+)x(\d+)/.exec(wmSizeOutput);
  if (!match) throw new Error(`Cannot parse screen size from: ${wmSizeOutput}`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

/**
 * deltaY(CSS px)를 기기 픽셀 스와이프 거리로 환산한다.
 * 화면 밖으로 나가지 않도록 화면 높이의 60%로 제한.
 */
export function toSwipeDistance(deltaY: number, screenHeight: number): number {
  const scaled = (deltaY * screenHeight) / REFERENCE_VIEWPORT_HEIGHT;
  const limit = screenHeight * 0.6;
  return Math.max(-limit, Math.min(limit, Math.round(scaled)));
}

/**
 * 실제 Android pane — 에뮬레이터(또는 USB 실기기)의 진짜 Android Chrome이 렌더링한다.
 * adb input이 있어서 iOS 시뮬레이터와 달리 탭/스크롤/타이핑까지 완전 미러링된다.
 */
export class AndroidEmulatorSession implements InputTarget {
  private disposed = false;
  private activeUntil = 0;
  private lastFrame: Buffer | null = null;
  private currentUrl: string;

  private constructor(
    private readonly adbPath: string,
    private readonly serial: string,
    private readonly screen: { width: number; height: number },
    initialUrl: string,
  ) {
    this.currentUrl = initialUrl;
  }

  static async launch(url: string, events: SessionEvents): Promise<AndroidEmulatorSession> {
    events.onStatus(ENGINE, 'starting');
    const sdkDir = resolveAndroidSdkDir();
    if (!sdkDir) {
      throw new Error(
        'Android SDK not found — install platform-tools/emulator (e.g. brew install --cask android-commandlinetools)',
      );
    }
    const adbPath = join(sdkDir, 'platform-tools/adb');

    let serial = await findConnectedDevice(adbPath);
    if (!serial) {
      serial = await bootHeadlessEmulator(sdkDir, adbPath);
    }

    // 기기의 localhost가 개발 머신을 가리키도록 포트를 역포워딩한다
    const targetPort = new URL(url).port;
    if (targetPort) {
      await adb(adbPath, serial, ['reverse', `tcp:${targetPort}`, `tcp:${targetPort}`]);
    }

    const wmSize = await adb(adbPath, serial, ['shell', 'wm', 'size']);
    const screen = parseScreenSize(wmSize.stdout);

    const session = new AndroidEmulatorSession(adbPath, serial, screen, url);
    await session.skipChromeFirstRun();
    await session.openUrl(url);
    events.onStatus(ENGINE, 'ready', serial);
    session.startPolling(events);
    return session;
  }

  private async openUrl(url: string): Promise<void> {
    this.currentUrl = url;
    // 기본 브라우저가 지정되지 않은 에뮬레이터 이미지는 일반 VIEW 인텐트를
    // 해석하지 못한다 — 진짜 Android Chrome을 컴포넌트로 직접 지정한다
    try {
      await this.shell([
        'am',
        'start',
        '-n',
        'com.android.chrome/com.google.android.apps.chrome.Main',
        '-a',
        'android.intent.action.VIEW',
        '-d',
        url,
      ]);
    } catch {
      await this.shell(['am', 'start', '-a', 'android.intent.action.VIEW', '-d', url]);
    }
  }

  /** Chrome 첫 실행 화면(FRE)을 건너뛴다 — userdebug 에뮬레이터 이미지에서 동작하는 best-effort */
  private async skipChromeFirstRun(): Promise<void> {
    await this.shell([
      'sh',
      '-c',
      `echo "_ --no-first-run --disable-fre --no-default-browser-check" > /data/local/tmp/chrome-command-line`,
    ]).catch(() => undefined);
    await this.shell(['am', 'set-debug-app', '--persistent', 'com.android.chrome']).catch(
      () => undefined,
    );
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
    try {
      // screencap -p는 PNG를 stdout으로 출력한다 (createImageBitmap은 포맷을 스니핑하므로 OK)
      const { stdout } = await execFileAsync(
        this.adbPath,
        ['-s', this.serial, 'exec-out', 'screencap', '-p'],
        { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 15_000 },
      );
      const frame = stdout as unknown as Buffer;
      if (frame.length === 0 || this.lastFrame?.equals(frame)) return;
      this.lastFrame = frame;
      events.onFrame(ENGINE, frame, -1); // 스크롤 위치는 알 수 없다
    } catch {
      // 부팅 직후/일시적 실패 — 루프 유지
    }
  }

  markActivity(): void {
    this.activeUntil = Date.now() + ACTIVITY_WINDOW_MS;
  }

  async clickAt(normalizedX: number, normalizedY: number): Promise<void> {
    const x = Math.round(normalizedX * this.screen.width);
    const y = Math.round(normalizedY * this.screen.height);
    await this.shell(['input', 'tap', String(x), String(y)]);
  }

  async scrollBy(deltaY: number): Promise<void> {
    const distance = toSwipeDistance(deltaY, this.screen.height);
    if (distance === 0) return;
    const x = Math.round(this.screen.width / 2);
    const startY = Math.round(this.screen.height / 2 + distance / 2);
    const endY = startY - distance;
    await this.shell(['input', 'swipe', String(x), String(startY), String(x), String(endY), '80']);
  }

  async pressKey(key: string): Promise<void> {
    const keycode = ANDROID_KEYCODES[key];
    if (keycode !== undefined) await this.shell(['input', 'keyevent', String(keycode)]);
  }

  async typeText(text: string): Promise<void> {
    // input text는 공백을 %s로 이스케이프해야 한다
    await this.shell(['input', 'text', text.replace(/ /g, '%s')]);
  }

  async goBack(): Promise<void> {
    await this.pressKey('Back');
  }

  async goForward(): Promise<void> {
    await this.pressKey('Forward');
  }

  async reload(): Promise<void> {
    await this.openUrl(this.currentUrl);
  }

  async navigate(url: string): Promise<void> {
    await this.openUrl(url);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    // 다음 실행이 빨라지도록 에뮬레이터는 부팅 상태로 둔다
  }

  private shell(args: string[]): Promise<{ stdout: string; stderr: string }> {
    return adb(this.adbPath, this.serial, ['shell', ...args]);
  }
}

async function findConnectedDevice(adbPath: string): Promise<string | undefined> {
  const { stdout } = await execFileAsync(adbPath, ['devices'], { timeout: 15_000 });
  const line = stdout
    .split('\n')
    .slice(1)
    .find((row) => row.trim().endsWith('device'));
  return line?.split(/\s+/)[0];
}

/** AVD가 있으면 헤드리스로 부팅하고 boot_completed까지 대기한다 */
async function bootHeadlessEmulator(sdkDir: string, adbPath: string): Promise<string> {
  const emulatorPath = join(sdkDir, 'emulator/emulator');
  if (!existsSync(emulatorPath)) {
    throw new Error('No connected Android device and no emulator installed');
  }
  const { stdout: avdList } = await execFileAsync(emulatorPath, ['-list-avds'], {
    timeout: 15_000,
  });
  const avd = avdList
    .split('\n')
    .map((row) => row.trim())
    // 최신 SDK는 안내 문구를 섞어 출력한다 — AVD 이름만 남긴다
    .find((row) => row.length > 0 && !row.includes(' '));
  if (!avd) throw new Error('No Android AVD found — create one with avdmanager');

  spawn(emulatorPath, ['-avd', avd, '-no-window', '-no-audio', '-no-boot-anim'], {
    detached: true,
    stdio: 'ignore',
  }).unref();

  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const serial = await findConnectedDevice(adbPath);
    if (serial) {
      const { stdout } = await execFileAsync(
        adbPath,
        ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'],
        { timeout: 10_000 },
      ).catch(() => ({ stdout: '' }));
      if (stdout.trim() === '1') return serial;
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  throw new Error('Android emulator boot timed out');
}

function adb(
  adbPath: string,
  serial: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(adbPath, ['-s', serial, ...args], { timeout: 30_000 });
}
