/**
 * 실기기 pane 공용 캡처 루프 — 순차 실행(겹침 금지) + 입력 시 즉시 기상.
 * 스크린샷 명령(simctl/adb)은 회당 수백 ms라 주기를 줄이는 것만으로는
 * 입력 반응이 늦다: wake()가 대기 중인 sleep을 끊고 바로 다음 캡처를 돌린다.
 */

export interface CaptureLoopOptions {
  capture: () => Promise<void>;
  /** true면 activeIntervalMs, 아니면 idleIntervalMs로 대기 */
  isActive: () => boolean;
  activeIntervalMs: number;
  idleIntervalMs: number;
}

export interface CaptureLoop {
  /** 대기 중이면 즉시 다음 캡처로 — 입력 직후 화면 반영 지연을 없앤다 */
  wake(): void;
  stop(): void;
}

export function startCaptureLoop(options: CaptureLoopOptions): CaptureLoop {
  let stopped = false;
  let wakeResolver: (() => void) | null = null;

  const sleepUntilWake = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        wakeResolver = null;
        resolve();
      }, ms);
      wakeResolver = () => {
        clearTimeout(timer);
        wakeResolver = null;
        resolve();
      };
    });

  void (async () => {
    while (!stopped) {
      await options.capture();
      if (stopped) break;
      const interval = options.isActive() ? options.activeIntervalMs : options.idleIntervalMs;
      await sleepUntilWake(interval);
    }
  })();

  return {
    wake() {
      wakeResolver?.();
    },
    stop() {
      stopped = true;
      wakeResolver?.();
    },
  };
}
