import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { InputTarget, SessionEvents } from './session.js';

const execFileAsync = promisify(execFile);

const ENGINE = 'ios-sim' as const;
const BOOT_TIMEOUT_MS = 120_000;
// 시뮬레이터 스크린샷은 회당 수백 ms가 걸려 브라우저 엔진보다 느리게 폴링한다
const IDLE_CAPTURE_INTERVAL_MS = 1_500;
const ACTIVE_CAPTURE_INTERVAL_MS = 600;
const ACTIVITY_WINDOW_MS = 5_000;

const XCODE_DEVELOPER_DIR = '/Applications/Xcode.app/Contents/Developer';

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
): { udid: string; name: string; runtime: string } | undefined {
  const parsed = JSON.parse(simctlListJson) as { devices: Record<string, SimctlDevice[]> };
  const candidates: { udid: string; name: string; runtime: string; booted: boolean }[] = [];
  for (const [runtimeId, devices] of Object.entries(parsed.devices)) {
    const runtime = runtimeId.replace('com.apple.CoreSimulator.SimRuntime.', '');
    if (!runtime.startsWith('iOS')) continue;
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

  private constructor(
    private readonly udid: string,
    private readonly developerDir: string,
    initialUrl: string,
  ) {
    this.currentUrl = initialUrl;
  }

  static async launch(url: string, events: SessionEvents): Promise<IosSimulatorSession> {
    events.onStatus(ENGINE, 'starting');
    const developerDir = resolveDeveloperDir();
    if (!developerDir) {
      throw new Error('iOS Simulator pane requires macOS with Xcode.app installed');
    }

    const list = await simctl(developerDir, ['list', 'devices', 'available', '-j']);
    const device = chooseSimulatorDevice(list.stdout);
    if (!device) throw new Error('No available iPhone simulator found');

    // 이미 부팅돼 있으면 boot가 149를 반환한다 — 무시
    await simctl(developerDir, ['boot', device.udid]).catch(() => undefined);
    await simctl(developerDir, ['bootstatus', device.udid, '-b'], BOOT_TIMEOUT_MS);
    // 헤드리스 부팅 직후에는 openurl이 타임아웃된다 —
    // Safari를 먼저 실행해두면 openurl이 기존 프로세스로 전달돼 즉시 성공한다
    await simctl(developerDir, ['launch', device.udid, 'com.apple.mobilesafari']).catch(
      () => undefined,
    );

    const session = new IosSimulatorSession(device.udid, developerDir, url);
    await session.openUrl(url);
    events.onStatus(ENGINE, 'ready', `${device.name} (${device.runtime.replace(/-/g, ' ')})`);
    events.onNavigation(ENGINE, url);
    session.startPolling(events);
    return session;
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
    await this.openUrl(url);
  }

  async reload(): Promise<void> {
    await this.openUrl(this.currentUrl);
  }

  // 시뮬레이터에는 입력 주입 채널이 없다(idb/WebDriverAgent 필요) — view-only
  async clickAt(): Promise<void> {}
  async scrollBy(): Promise<void> {}
  async pressKey(): Promise<void> {}
  async typeText(): Promise<void> {}
  async goBack(): Promise<void> {}
  async goForward(): Promise<void> {}

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
