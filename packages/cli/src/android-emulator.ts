import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as net from 'node:net';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { ensureAndroidShellApk } from './android-shell.js';
import { type CaptureLoop, startCaptureLoop } from './capture-loop.js';
import { EmulatorGrpc } from './emulator-grpc.js';
import type { InputTarget, SessionEvents } from './session.js';

const execFileAsync = promisify(execFile);

const ENGINE = 'android' as const;
const BOOT_TIMEOUT_MS = 180_000;
// 에뮬레이터 screencap은 회당 수백 ms — 브라우저 엔진보다 느리게 폴링한다
const IDLE_CAPTURE_INTERVAL_MS = 1_500;
const ACTIVE_CAPTURE_INTERVAL_MS = 400;
// 이보다 짧은 스와이프는 Android 터치 슬롭 근처라 탭으로 오인될 수 있다
const MIN_SWIPE_PX = 60;
// gRPC 제스처는 fling 없는 정밀 스크롤 — 탭 슬롭(~24px)만 넘기면 된다
const MIN_GRPC_SCROLL_PX = 32;
/** scrcpy 프레임의 긴 변 상한 — 대시보드 델타(프레임 px)를 기기 px로 환산할 때도 쓴다 */
const SCRCPY_MAX_SIZE = 1600;
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

/** Windows는 실행 파일 확장자가 다르다 */
export function adbExecutableName(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'adb.exe' : 'adb';
}

export function emulatorExecutableName(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'emulator.exe' : 'emulator';
}

/** OS별 Android SDK 표준 설치 경로 후보 (환경변수 최우선) */
export function androidSdkCandidateDirs(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string[] {
  const candidates = [env.ANDROID_HOME, env.ANDROID_SDK_ROOT];
  if (platform === 'darwin') {
    candidates.push(
      join(home, 'Library/Android/sdk'),
      '/opt/homebrew/share/android-commandlinetools',
    );
  } else if (platform === 'win32') {
    if (env.LOCALAPPDATA) candidates.push(join(env.LOCALAPPDATA, 'Android', 'Sdk'));
  } else {
    candidates.push(join(home, 'Android/Sdk'));
  }
  return candidates.filter((dir): dir is string => Boolean(dir));
}

export function resolveAndroidSdkDir(): string | undefined {
  return androidSdkCandidateDirs().find((dir) =>
    existsSync(join(dir, 'platform-tools', adbExecutableName())),
  );
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
  private activeUntil = 0;
  private lastFrame: Buffer | null = null;
  private currentUrl: string;

  private events?: SessionEvents;
  /** shell = 자체 WebView 셸앱(앱 임베드 재현 + 콘솔 릴레이), chrome = 브라우저 폴백 */
  private mode: 'shell' | 'chrome' = 'chrome';
  private readonly commandQueue: Record<string, unknown>[] = [];
  private commandWaiter: ((commands: Record<string, unknown>[]) => void) | null = null;

  private constructor(
    private readonly adbPath: string,
    private readonly serial: string,
    private readonly screen: { width: number; height: number },
    initialUrl: string,
  ) {
    this.currentUrl = initialUrl;
  }

  static async launch(
    url: string,
    events: SessionEvents,
    options: { controlUrl?: string } = {},
  ): Promise<AndroidEmulatorSession> {
    events.onStatus(ENGINE, 'starting');
    const sdkDir = resolveAndroidSdkDir();
    if (!sdkDir) {
      throw new Error(
        'Android SDK not found — install platform-tools/emulator (e.g. brew install --cask android-commandlinetools)',
      );
    }
    const adbPath = join(sdkDir, 'platform-tools', adbExecutableName());

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
    // 1순위: 자체 WebView 셸앱 — Chrome UI 없이 앱 임베드 웹뷰 그대로 + 콘솔 릴레이.
    // 빌드툴이 없거나 실패하면 Chrome 폴백 (이유는 콘솔에 남긴다)
    let detail = `${serial} · Chrome`;
    if (options.controlUrl) {
      try {
        const controlPort = new URL(options.controlUrl).port;
        const apkPath = await ensureAndroidShellApk(sdkDir);
        await adb(adbPath, serial, ['reverse', `tcp:${controlPort}`, `tcp:${controlPort}`]);
        await adb(adbPath, serial, ['install', '-r', apkPath]);
        await adb(adbPath, serial, [
          'shell',
          'am',
          'start',
          '-n',
          'dev.crosspane.shell/.MainActivity',
          '--es',
          'url',
          url,
          '--es',
          'control',
          options.controlUrl,
        ]);
        session.mode = 'shell';
        detail = `${serial} · WebView`;
      } catch (err) {
        const reason = err instanceof Error ? err.message.split('\n')[0] : String(err);
        console.warn(`  ⚠ android: WebView 셸 실패 → Chrome 폴백: ${reason.slice(0, 200)}`);
      }
    }
    session.grpc = (await EmulatorGrpc.connect(sdkDir, 8554)) ?? null;
    if (session.grpc) detail += ' · gRPC';

    events.onStatus(ENGINE, 'ready', detail);
    session.events = events;
    session.startPolling(events);
    // 화면은 scrcpy h264가 최적(RAW는 WS 대역폭 배압으로 역효과 실측) —
    // gRPC는 입력(sendTouch, 왕복 수 ms) 전담
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

  private captureLoop: CaptureLoop | null = null;
  private viewersActive = true;
  private stopped = false;
  private videoProcess: ReturnType<typeof spawn> | null = null;
  private videoChunkHandler: ((chunk: Buffer) => void) | null = null;
  private videoBytesReceived = 0;
  private scrcpySocket: net.Socket | null = null;
  /** 에뮬레이터 공식 gRPC — 연결되면 터치/화면이 이 경로를 쓴다 (adb/인코더 세금 제거) */
  private grpc: EmulatorGrpc | null = null;

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
    // 입력 직후 즉시 캡처 — 화면 반영 지연이 폴링 간격만큼 늘어지는 것을 막는다
    this.captureLoop?.wake();
  }

  private enqueue(command: Record<string, unknown>): void {
    this.commandQueue.push(command);
    if (this.commandWaiter) {
      const waiter = this.commandWaiter;
      this.commandWaiter = null;
      waiter(this.commandQueue.splice(0));
    } else if (this.commandQueue.length > 200) {
      this.commandQueue.splice(0, this.commandQueue.length - 200);
    }
    this.markActivity();
  }

  /** 셸 명령 롱폴 — iOS 셸과 동일 규약 (server /shell/android/commands) */
  waitForShellCommands(): Promise<unknown[]> {
    if (this.commandQueue.length > 0) return Promise.resolve(this.commandQueue.splice(0));
    this.commandWaiter?.([]);
    return new Promise((resolve) => {
      const waiter = (commands: Record<string, unknown>[]): void => {
        clearTimeout(timer);
        resolve(commands);
      };
      const timer = setTimeout(() => {
        if (this.commandWaiter === waiter) this.commandWaiter = null;
        resolve([]);
      }, 8_000);
      this.commandWaiter = waiter;
    });
  }

  /** 셸앱이 POST한 이벤트(콘솔/에러/내비게이션) → 세션 이벤트 */
  handleShellEvent(payload: unknown): void {
    if (!this.events || typeof payload !== 'object' || payload === null) return;
    const event = payload as { kind?: string; level?: string; text?: string; url?: string };
    if (event.kind === 'console') {
      this.events.onConsole(ENGINE, event.level ?? 'log', event.text ?? '');
    } else if (event.kind === 'pageerror') {
      this.events.onPageError(ENGINE, event.text ?? '');
    } else if (event.kind === 'navigation' && event.url) {
      this.currentUrl = event.url;
      this.events.onNavigation(ENGINE, event.url);
    }
  }

  /** 시청자 0명이면 화면 스트림도 멈춘다 */
  setViewersActive(active: boolean): void {
    if (this.viewersActive === active) return;
    this.viewersActive = active;
    if (active) {
      this.captureLoop?.wake();
      if (this.videoChunkHandler && !this.videoProcess) this.spawnVideoStream();
    } else if (this.videoProcess) {
      const proc = this.videoProcess;
      this.videoProcess = null; // exit 핸들러의 재시작 방지 표식
      proc.kill('SIGKILL');
    }
  }

  /** 연속 터치 — motionevent DOWN/MOVE/UP으로 손가락 제스처를 그대로 재생한다.
      네이티브 스크롤 물리(관성/러버밴드)가 실제 제스처 속도에서 나온다 */
  // move 백로그 방지: input 실행(~35ms/개)보다 move가 빨리 오면 큐가 쌓여
  // 드래그가 뒤로 갈수록 밀린다 — 최신 좌표만 유지하고 40ms 간격으로 방출
  private pendingMove: { x: number; y: number } | null = null;
  private moveTimer: NodeJS.Timeout | null = null;
  private lastMoveSentAt = 0;

  async touchAt(phase: 'down' | 'move' | 'up', normalizedX: number, normalizedY: number) {
    const x = Math.round(normalizedX * this.screen.width);
    const y = Math.round(normalizedY * this.screen.height);
    if (this.grpc) {
      // gRPC 터치는 왕복 ~수 ms — 스로틀/백로그 관리가 필요 없다
      this.grpc.sendTouch(x, y, phase === 'up' ? 0 : 1024);
      this.markActivity();
      return;
    }
    if (phase === 'move') {
      this.pendingMove = { x, y };
      const wait = 40 - (Date.now() - this.lastMoveSentAt);
      if (wait <= 0) this.flushMove();
      else if (!this.moveTimer) this.moveTimer = setTimeout(() => this.flushMove(), wait);
      return;
    }
    this.flushMove(); // up/down 전에 마지막 move 순서 보장
    this.runInputCommand(['input', 'motionevent', phase.toUpperCase(), x, y]);
  }

  private flushMove(): void {
    if (this.moveTimer) {
      clearTimeout(this.moveTimer);
      this.moveTimer = null;
    }
    const move = this.pendingMove;
    this.pendingMove = null;
    if (!move) return;
    this.lastMoveSentAt = Date.now();
    this.runInputCommand(['input', 'motionevent', 'MOVE', move.x, move.y]);
  }

  async clickAt(normalizedX: number, normalizedY: number): Promise<void> {
    const x = Math.round(normalizedX * this.screen.width);
    const y = Math.round(normalizedY * this.screen.height);
    if (this.grpc) {
      this.grpc.sendTouch(x, y, 1024);
      setTimeout(() => this.grpc?.sendTouch(x, y, 0), 50);
      return;
    }
    this.runInputCommand(['input', 'tap', x, y]);
  }

  async dragBetween(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    durationMs: number,
  ): Promise<void> {
    // input swipe는 진짜 터치 제스처다 — 네이티브 스크롤/스와이프가 그대로 동작한다
    const duration = Math.max(40, Math.min(1_000, Math.round(durationMs)));
    this.runInputCommand([
      'input',
      'swipe',
      Math.round(fromX * this.screen.width),
      Math.round(fromY * this.screen.height),
      Math.round(toX * this.screen.width),
      Math.round(toY * this.screen.height),
      duration,
    ]);
  }

  // 짧은 스와이프는 Android가 탭으로 오인할 수 있다(실측: 카드 클릭 유발) —
  // 델타를 누적해 최소 길이 이상일 때만 스와이프로 방출한다
  private pendingScrollPx = 0;

  /** 대시보드 델타는 scrcpy 프레임 px — 기기 px로 환산 */
  private frameToDevicePx(delta: number): number {
    const longSide = Math.max(this.screen.width, this.screen.height);
    return longSide > SCRCPY_MAX_SIZE ? delta * (longSide / SCRCPY_MAX_SIZE) : delta;
  }

  async scrollBy(deltaY: number): Promise<void> {
    const limit = this.screen.height * 0.6;
    this.pendingScrollPx += Math.max(-limit, Math.min(limit, this.frameToDevicePx(deltaY)));
    if (this.grpc) return this.flushWheelGesture();
    const distance = Math.trunc(this.pendingScrollPx);
    if (Math.abs(distance) < MIN_SWIPE_PX) return;
    this.pendingScrollPx -= distance;
    const x = Math.round(this.screen.width / 2);
    const startY = Math.round(this.screen.height / 2 + distance / 2);
    const endY = startY - distance;
    // duration을 짧게 주면 fling으로 해석돼 관성이 과하게 붙는다 — 드래그로 해석되는 길이
    this.runInputCommand(['input', 'swipe', x, startY, x, endY, 140]);
  }

  private wheelGestureRunning = false;

  /**
   * 휠 스크롤을 gRPC 터치 제스처로 — adb `input swipe`(스폰+애니메이션 ~250ms) 대비
   * 시작 지연이 수 ms다. 끝에서 잠깐 멈춘 뒤 떼서 fling이 붙지 않는 정밀 스크롤이 된다.
   * 제스처 중 도착한 델타는 누적했다가 끝난 직후 이어서 방출한다.
   */
  private async flushWheelGesture(): Promise<void> {
    if (this.wheelGestureRunning) return;
    const grpc = this.grpc;
    if (!grpc) return;
    const distance = Math.trunc(this.pendingScrollPx);
    if (Math.abs(distance) < MIN_GRPC_SCROLL_PX) return;
    this.pendingScrollPx -= distance;
    this.wheelGestureRunning = true;
    try {
      const x = Math.round(this.screen.width / 2);
      const clampY = (y: number) => Math.max(10, Math.min(this.screen.height - 10, y));
      const startY = clampY(Math.round(this.screen.height / 2 + distance / 2));
      const endY = clampY(startY - distance);
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const steps = 4;
      grpc.sendTouch(x, startY, 1024);
      for (let i = 1; i <= steps; i++) {
        await sleep(12);
        grpc.sendTouch(x, Math.round(startY + ((endY - startY) * i) / steps), 1024);
      }
      await sleep(50); // 속도 0으로 홀드 — fling 방지
      grpc.sendTouch(x, endY, 0);
    } finally {
      this.wheelGestureRunning = false;
    }
    if (Math.abs(this.pendingScrollPx) >= MIN_GRPC_SCROLL_PX) void this.flushWheelGesture();
  }

  async pressKey(key: string): Promise<void> {
    const keycode = ANDROID_KEYCODES[key];
    if (keycode !== undefined) this.runInputCommand(['input', 'keyevent', keycode]);
  }

  async typeText(text: string): Promise<void> {
    // adb `input text`는 ASCII만 주입 가능 — 한글 등은 IME 앱(ADBKeyboard) 없이는 불가.
    // 조용히 사라지면 버그처럼 보이므로 콘솔에 이유를 남긴다
    if (/[^\x20-\x7e]/.test(text)) {
      this.events?.onConsole(
        ENGINE,
        'warning',
        `[crosspane] Android 에뮬레이터는 비ASCII 입력(한글 등)을 지원하지 않습니다 (adb 한계): "${text}"`,
      );
      return;
    }
    // input text는 공백을 %s로 이스케이프해야 한다
    await this.shell(['input', 'text', text.replace(/ /g, '%s')]);
  }

  async goBack(): Promise<void> {
    if (this.mode === 'shell') return this.enqueue({ type: 'back' });
    await this.pressKey('Back');
  }

  async goForward(): Promise<void> {
    if (this.mode === 'shell') return this.enqueue({ type: 'forward' });
    await this.pressKey('Forward');
  }

  async reload(): Promise<void> {
    if (this.mode === 'shell') return this.enqueue({ type: 'reload' });
    await this.openUrl(this.currentUrl);
  }

  async navigate(url: string): Promise<void> {
    this.currentUrl = url;
    if (this.mode === 'shell') return this.enqueue({ type: 'navigate', url });
    await this.openUrl(url);
  }

  /**
   * 실시간 비디오 스트림 시작 — `screenrecord`의 H.264를 stdout으로 파이프한다.
   * 스크린샷 폴링(2~3fps)과 달리 진짜 화면 스트림(30fps)이다.
   * screenrecord는 최대 180초 제한이 있어 종료 시 자동 재시작한다.
   */
  startVideoStream(onChunk: (chunk: Buffer) => void): void {
    this.videoChunkHandler = onChunk;
    this.spawnVideoStream();
  }

  /** 새 대시보드 접속 시 — 프로세스를 재시작해 SPS/PPS+키프레임부터 다시 보낸다 */
  restartVideoStream(): void {
    if (this.videoChunkHandler && this.videoProcess) this.videoProcess.kill('SIGKILL');
  }

  /** brew 설치 scrcpy의 서버 jar — 인코더 직결이라 screenrecord(~300ms)보다 지연이 한 자릿수 낮다 */
  private static scrcpyServerJar(): string | undefined {
    const candidates = [
      '/opt/homebrew/share/scrcpy/scrcpy-server',
      '/usr/local/share/scrcpy/scrcpy-server',
    ];
    return candidates.find((path) => existsSync(path));
  }

  private spawnVideoStream(): void {
    if (this.stopped || !this.videoChunkHandler) return;
    const jar = AndroidEmulatorSession.scrcpyServerJar();
    if (jar) {
      void this.spawnScrcpyStream(jar).catch(() => this.spawnScreenrecordStream());
      return;
    }
    this.spawnScreenrecordStream();
  }

  /**
   * scrcpy 서버 스트림 — MediaCodec 직결 raw H.264 (Annex-B).
   * 소켓/서버는 1회용: 끊기면 exit 핸들러가 재기동한다 (키프레임 재시작 겸용).
   */
  private async spawnScrcpyStream(jar: string): Promise<void> {
    await adb(this.adbPath, this.serial, ['push', jar, '/data/local/tmp/scrcpy-server.jar']);
    const version = basename(dirname(jar)) === 'scrcpy' ? await scrcpyVersion() : '4.1';
    const proc = spawn(
      this.adbPath,
      [
        '-s',
        this.serial,
        'shell',
        `CLASSPATH=/data/local/tmp/scrcpy-server.jar app_process / com.genymobile.scrcpy.Server ${version} tunnel_forward=true video=true audio=false control=false cleanup=false raw_stream=true max_size=${SCRCPY_MAX_SIZE} video_bit_rate=10000000`,
      ],
      { stdio: ['ignore', 'ignore', 'ignore'] },
    );
    this.videoProcess = proc;
    proc.on('error', () => this.spawnScreenrecordStream());
    proc.on('exit', () => {
      this.scrcpySocket?.destroy();
      this.scrcpySocket = null;
      if (!this.stopped && this.viewersActive && this.videoProcess === proc) {
        setTimeout(() => this.spawnVideoStream(), 300);
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 700)); // 서버 리슨 대기
    const port = 27100 + Math.floor(Math.random() * 800);
    await adb(this.adbPath, this.serial, ['forward', `tcp:${port}`, 'localabstract:scrcpy']);
    const socket = net.connect(port, '127.0.0.1');
    this.scrcpySocket = socket;
    socket.on('data', (chunk: Buffer) => {
      this.videoBytesReceived += chunk.length;
      if (this.videoBytesReceived > 100_000) this.captureLoop?.stop();
      this.videoChunkHandler?.(chunk);
    });
    socket.on('error', () => proc.kill('SIGKILL'));
    socket.on('close', () => proc.kill('SIGKILL'));
  }

  private spawnScreenrecordStream(): void {
    if (this.stopped || !this.videoChunkHandler) return;
    const proc = spawn(
      this.adbPath,
      [
        '-s',
        this.serial,
        'exec-out',
        'screenrecord',
        '--output-format=h264',
        // 절반 해상도 — 인코딩/전송/디코딩 지연이 크게 줄고 pane 표시 크기에는 충분
        '--size',
        `${Math.floor(this.screen.width / 2 / 2) * 2}x${Math.floor(this.screen.height / 2 / 2) * 2}`,
        '--bit-rate',
        '4000000',
        '--time-limit',
        '180',
        '-',
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    this.videoProcess = proc;
    proc.stdout?.on('data', (chunk: Buffer) => {
      this.videoBytesReceived += chunk.length;
      // 스트림이 실제로 흐르기 시작하면 스크린샷 폴링은 낭비 + 오버드로 — 중단한다
      if (this.videoBytesReceived > 100_000) this.captureLoop?.stop();
      this.videoChunkHandler?.(chunk);
    });
    proc.on('error', () => {
      // spawn 실패(구형 이미지 등) — 스크린샷 폴링 폴백이 계속 동작한다
    });
    proc.on('exit', () => {
      // 시청자 없음으로 의도적으로 멈춘 경우(videoProcess=null)는 재시작하지 않는다
      if (!this.stopped && this.viewersActive && this.videoProcess === proc) {
        setTimeout(() => this.spawnVideoStream(), 300);
      }
    });
  }

  async dispose(): Promise<void> {
    this.stopped = true;
    this.grpc?.close();
    this.inputShell?.kill();
    this.videoProcess?.kill('SIGKILL');
    this.captureLoop?.stop();
    // 다음 실행이 빨라지도록 에뮬레이터는 부팅 상태로 둔다
  }

  private shell(args: string[]): Promise<{ stdout: string; stderr: string }> {
    return adb(this.adbPath, this.serial, ['shell', ...args]);
  }

  // ── 입력 핫패스: 상주 adb shell ─────────────────────────
  // 입력마다 adb 프로세스를 새로 띄우면 스폰 비용(~50-150ms)이 그대로 지연이 된다.
  // `adb shell`을 하나 상주시키고 stdin으로 명령만 흘려 ~10ms로 줄인다.
  private inputShell: ReturnType<typeof spawn> | null = null;

  /** 인자 안전성: 이 경로는 숫자/키코드 인자 전용 (임의 문자열 금지 — text는 exec 경로 사용) */
  private runInputCommand(parts: (string | number)[]): void {
    if (!this.inputShell || this.inputShell.exitCode !== null) {
      this.inputShell = spawn(this.adbPath, ['-s', this.serial, 'shell'], {
        stdio: ['pipe', 'ignore', 'ignore'],
      });
      this.inputShell.on('error', () => {
        this.inputShell = null;
      });
    }
    this.inputShell.stdin?.write(`${parts.join(' ')}\n`);
  }
}

/** scrcpy CLI 버전 — 서버 jar와 버전 문자열이 일치해야 한다 */
async function scrcpyVersion(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('scrcpy', ['--version'], { timeout: 5_000 });
    return /scrcpy (\S+)/.exec(stdout)?.[1] ?? '4.1';
  } catch {
    return '4.1';
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
  const emulatorPath = join(sdkDir, 'emulator', emulatorExecutableName());
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

  // -gpu host: 호스트 GPU 가속 — 헤드리스에서도 WebView 렌더/인코딩 fps가 크게 오른다
  spawn(
    emulatorPath,
    // -grpc: 공식 컨트롤 API (터치/화면 스트림 직결) — Android Studio 미러링과 동일 경로
    ['-avd', avd, '-no-window', '-no-audio', '-no-boot-anim', '-gpu', 'host', '-grpc', '8554'],
    {
      detached: true,
      stdio: 'ignore',
    },
  ).unref();

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
