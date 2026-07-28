/**
 * 셸앱 명령 롱폴 채널 — iOS/Android 셸이 공유하는 규약의 단일 구현.
 *
 * 규약 (입력 지연 0의 핵심 — 되돌리면 폴링 주기만큼 지연이 되살아난다):
 * - 큐가 비어 있으면 waitForCommands가 응답을 잡아두고, enqueue 시 즉시 해제
 * - 새 폴이 오면 이전 waiter는 빈 배열로 해제 (셸 재시작 등 중복 폴 대비)
 * - 셸이 폴링을 멈춘 상태(크래시 등)에서 입력이 계속 오면 큐가 무한 성장한다 — 상한
 */
export interface ShellCommandChannel {
  enqueue(command: Record<string, unknown>): void;
  waitForCommands(): Promise<Record<string, unknown>[]>;
  /** 대기 중인 롱폴을 빈 응답으로 해제한다 (세션 dispose 시 필수 — 응답이 8초간 잡힌다) */
  dispose(): void;
}

export function createShellCommandChannel(options: {
  longPollMs: number;
  maxQueued: number;
  /** 명령 발생 시 호출 — 세션의 markActivity(입력 직후 즉시 캡처)가 여기 걸린다 */
  onEnqueue?: () => void;
}): ShellCommandChannel {
  const queue: Record<string, unknown>[] = [];
  let waiter: ((commands: Record<string, unknown>[]) => void) | null = null;

  return {
    enqueue(command) {
      queue.push(command);
      if (waiter) {
        const release = waiter;
        waiter = null;
        release(queue.splice(0));
      } else if (queue.length > options.maxQueued) {
        queue.splice(0, queue.length - options.maxQueued);
      }
      options.onEnqueue?.();
    },

    waitForCommands() {
      if (queue.length > 0) return Promise.resolve(queue.splice(0));
      waiter?.([]);
      return new Promise((resolve) => {
        const release = (commands: Record<string, unknown>[]): void => {
          clearTimeout(timer);
          resolve(commands);
        };
        const timer = setTimeout(() => {
          if (waiter === release) waiter = null;
          resolve([]);
        }, options.longPollMs);
        waiter = release;
      });
    },

    dispose() {
      waiter?.([]);
      waiter = null;
      queue.length = 0;
    },
  };
}
