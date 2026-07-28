import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createShellCommandChannel } from '../src/shell-command-queue.js';

describe('createShellCommandChannel (셸 롱폴 규약)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const make = (onEnqueue?: () => void) =>
    createShellCommandChannel({ longPollMs: 8_000, maxQueued: 200, onEnqueue });

  it('큐가 비어 있으면 대기하고, enqueue 시 즉시 해제된다 (입력 지연 0)', async () => {
    const channel = make();
    const poll = channel.waitForCommands();
    channel.enqueue({ type: 'click' });
    await expect(poll).resolves.toEqual([{ type: 'click' }]);
  });

  it('큐에 명령이 있으면 즉시 드레인한다', async () => {
    const channel = make();
    channel.enqueue({ type: 'a' });
    channel.enqueue({ type: 'b' });
    await expect(channel.waitForCommands()).resolves.toEqual([{ type: 'a' }, { type: 'b' }]);
    await expect(Promise.race([channel.waitForCommands(), 'pending'])).resolves.toBe('pending');
  });

  it('새 폴이 오면 이전 waiter는 빈 배열로 해제된다 (셸 재시작 중복 폴)', async () => {
    const channel = make();
    const stale = channel.waitForCommands();
    const fresh = channel.waitForCommands();
    await expect(stale).resolves.toEqual([]);
    channel.enqueue({ type: 'click' });
    await expect(fresh).resolves.toEqual([{ type: 'click' }]);
  });

  it('명령이 없으면 longPollMs 후 빈 배열로 타임아웃한다', async () => {
    const channel = make();
    const poll = channel.waitForCommands();
    vi.advanceTimersByTime(8_000);
    await expect(poll).resolves.toEqual([]);
    // 타임아웃 후 enqueue는 다음 폴에서 정상 드레인 (waiter 정리 확인)
    channel.enqueue({ type: 'later' });
    await expect(channel.waitForCommands()).resolves.toEqual([{ type: 'later' }]);
  });

  it('셸이 폴링을 멈추면 큐가 상한에서 잘린다 (오래된 것부터 버림)', async () => {
    const channel = make();
    for (let i = 0; i < 250; i++) channel.enqueue({ i });
    const drained = await channel.waitForCommands();
    expect(drained).toHaveLength(200);
    expect(drained[0]).toEqual({ i: 50 });
  });

  it('enqueue마다 onEnqueue 콜백(markActivity)이 불린다', () => {
    const onEnqueue = vi.fn();
    const channel = make(onEnqueue);
    channel.enqueue({ type: 'a' });
    channel.enqueue({ type: 'b' });
    expect(onEnqueue).toHaveBeenCalledTimes(2);
  });

  it('dispose는 대기 중인 폴을 즉시 빈 응답으로 해제한다', async () => {
    const channel = make();
    const poll = channel.waitForCommands();
    channel.dispose();
    await expect(poll).resolves.toEqual([]);
  });
});
