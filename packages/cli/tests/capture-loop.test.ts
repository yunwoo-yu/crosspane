import { describe, expect, it, vi } from 'vitest';
import { startCaptureLoop } from '../src/capture-loop';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('startCaptureLoop', () => {
  it('wake()가 대기 중인 sleep을 끊고 즉시 다음 캡처를 돌린다', async () => {
    const capture = vi.fn(async () => {});
    const loop = startCaptureLoop({
      capture,
      isActive: () => false,
      activeIntervalMs: 10_000,
      idleIntervalMs: 10_000, // wake 없이는 다음 캡처가 오지 않는 간격
    });
    await tick();
    expect(capture).toHaveBeenCalledTimes(1);

    loop.wake();
    await tick();
    expect(capture).toHaveBeenCalledTimes(2);
    loop.stop();
  });

  it('stop() 이후에는 캡처가 더 돌지 않는다', async () => {
    const capture = vi.fn(async () => {});
    const loop = startCaptureLoop({
      capture,
      isActive: () => true,
      activeIntervalMs: 1,
      idleIntervalMs: 1,
    });
    await tick();
    loop.stop();
    const countAtStop = capture.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(capture.mock.calls.length).toBe(countAtStop);
  });

  it('활성 여부에 따라 간격을 고른다', async () => {
    const capture = vi.fn(async () => {});
    let active = true;
    const loop = startCaptureLoop({
      capture,
      isActive: () => active,
      activeIntervalMs: 1,
      idleIntervalMs: 10_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const activeCount = capture.mock.calls.length;
    expect(activeCount).toBeGreaterThan(2); // 1ms 간격으로 여러 번

    active = false;
    await new Promise((resolve) => setTimeout(resolve, 30));
    // idle 전환 후에는 사실상 멈춘다 (남은 1회 이내)
    expect(capture.mock.calls.length).toBeLessThanOrEqual(activeCount + 2);
    loop.stop();
  });
});

describe('shouldCapture 게이팅 (시청자 0명 = 캡처 0회)', () => {
  it('shouldCapture가 false면 캡처를 건너뛰고, wake로 즉시 재개된다', async () => {
    const capture = vi.fn(async () => {});
    let viewers = false;
    const loop = startCaptureLoop({
      capture,
      isActive: () => false,
      shouldCapture: () => viewers,
      activeIntervalMs: 1,
      idleIntervalMs: 5,
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(capture).not.toHaveBeenCalled(); // 시청자 없음 — 캡처 0회 (성능 계약)

    viewers = true;
    loop.wake();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(capture).toHaveBeenCalled(); // wake 즉시 재개
    loop.stop();
  });
});
