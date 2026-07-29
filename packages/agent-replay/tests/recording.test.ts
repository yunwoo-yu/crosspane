import type { CrosspaneAgent } from '@crosspane/agent';
import type { SessionEvent } from '@crosspane/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** rrweb은 무겁고 jsdom에서 완전히 동작하지 않는다 — 계약(콜백·해제)만 검증한다 */
const recordMock = vi.hoisted(() => vi.fn());
vi.mock('rrweb', () => ({ record: recordMock }));

const { SCREEN_FORMAT, startScreenRecording } = await import('../src/index');

function fakeAgent(enabled = true): CrosspaneAgent & { emitted: SessionEvent[] } {
  const emitted: SessionEvent[] = [];
  return {
    enabled,
    session: { id: 's-1', label: 'test', userAgent: 'ua', startedAt: 0 },
    capture: () => ({
      version: 1,
      session: { id: 's-1', label: 'test', userAgent: 'ua', startedAt: 0 },
      events: [],
      exportedAt: 0,
    }),
    exportFile() {},
    emit(event) {
      emitted.push(event);
    },
    dispose() {},
    emitted,
  };
}

describe('startScreenRecording', () => {
  beforeEach(() => recordMock.mockReset());

  it('rrweb 이벤트를 코어 타임라인에 screen 이벤트로 싣는다', () => {
    recordMock.mockReturnValue(() => {});
    const agent = fakeAgent();
    startScreenRecording(agent);

    // rrweb에 넘긴 emit 콜백을 호출값에서 직접 꺼낸다 (구현 콜백을 쓰면
    // mock 상태가 테스트 간에 새어 cleanup 훅에서 재호출된다)
    const options = recordMock.mock.calls[0][0] as { emit: (event: unknown) => void };
    options.emit({ type: 2, data: { node: {} } });
    expect(agent.emitted).toHaveLength(1);
    expect(agent.emitted[0]).toMatchObject({
      type: 'screen',
      sessionId: 's-1',
      format: SCREEN_FORMAT,
    });
  });

  it('에이전트가 비활성이면 기록하지 않는다 (게이팅 계약)', () => {
    startScreenRecording(fakeAgent(false));
    expect(recordMock).not.toHaveBeenCalled();
  });

  it('입력 마스킹이 기본값으로 켜져 있다 (DOM 기록은 화면 전문을 수집한다)', () => {
    recordMock.mockReturnValue(() => {});
    startScreenRecording(fakeAgent());
    expect(recordMock).toHaveBeenCalledWith(expect.objectContaining({ maskAllInputs: true }));
  });

  it('중간 재생을 위한 주기적 전체 스냅샷이 설정된다', () => {
    recordMock.mockReturnValue(() => {});
    startScreenRecording(fakeAgent(), { checkoutEveryNms: 5_000 });
    expect(recordMock).toHaveBeenCalledWith(expect.objectContaining({ checkoutEveryNms: 5_000 }));
  });

  it('stop()은 rrweb 해제 함수를 호출하고, 없어도 던지지 않는다', () => {
    const stopFn = vi.fn();
    recordMock.mockReturnValue(stopFn);
    startScreenRecording(fakeAgent()).stop();
    expect(stopFn).toHaveBeenCalled();

    recordMock.mockReturnValue(undefined); // rrweb이 기록을 시작하지 못한 경우
    expect(() => startScreenRecording(fakeAgent()).stop()).not.toThrow();
  });
});
