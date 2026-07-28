import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WHEEL_COALESCE_MS } from '../src/constants';
import { createScrollStreamer } from '../src/scroll-streamer';
import type { ClientCommand } from '../src/types';

describe('createScrollStreamer (휠 코얼레싱 불변식)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const make = () => {
    const sent: ClientCommand[] = [];
    const applied: number[] = [];
    const streamer = createScrollStreamer({
      sendCommand: (command) => sent.push(command),
      applyLocal: (deltaY) => applied.push(deltaY),
    });
    return { streamer, sent, applied };
  };

  it('델타는 로컬에 즉시 반영되고, 전송은 WHEEL_COALESCE_MS 동안 1개로 합산된다', () => {
    const { streamer, sent, applied } = make();
    streamer.add(10, 0);
    streamer.add(15, 5);
    streamer.add(-5, 10);
    expect(applied).toEqual([10, 15, -5]); // 체감 0ms — 건마다 즉시
    expect(sent).toHaveLength(0); // 아직 코얼레싱 중
    vi.advanceTimersByTime(WHEEL_COALESCE_MS);
    expect(sent).toEqual([{ type: 'scroll', deltaY: 20, x: undefined, y: undefined }]);
  });

  it('합산 결과가 반올림 후 0이면 전송하지 않는다', () => {
    const { streamer, sent } = make();
    streamer.add(0.2, 0);
    streamer.add(-0.1, 5);
    vi.advanceTimersByTime(WHEEL_COALESCE_MS);
    expect(sent).toHaveLength(0);
  });

  it('마지막 포인터 위치(nx/ny)가 커맨드에 실린다', () => {
    const { streamer, sent } = make();
    streamer.add(10, 0, 0.2, 0.3);
    streamer.add(10, 5, 0.4, 0.5);
    vi.advanceTimersByTime(WHEEL_COALESCE_MS);
    expect(sent[0]).toEqual({ type: 'scroll', deltaY: 20, x: 0.4, y: 0.5 });
  });

  it('flush는 대기 중인 델타를 즉시 전송하고 타이머를 지운다', () => {
    const { streamer, sent } = make();
    streamer.add(30, 0);
    streamer.flush();
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(WHEEL_COALESCE_MS * 2);
    expect(sent).toHaveLength(1); // 타이머가 중복 전송하지 않는다
  });

  it('dispose 후에는 대기 중이던 전송이 나가지 않는다 (pane 언마운트)', () => {
    const { streamer, sent } = make();
    streamer.add(30, 0);
    streamer.dispose();
    vi.advanceTimersByTime(WHEEL_COALESCE_MS * 2);
    expect(sent).toHaveLength(0);
  });
});
