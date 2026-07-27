import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCrosspaneSocket } from '../src/hooks/useCrosspaneSocket';
import type { ServerEvent } from '../src/types';

/** 네트워크 없이 서버 이벤트/프레임을 주입할 수 있는 WebSocket 대역 */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly OPEN = 1;

  binaryType = 'blob';
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: string | ArrayBuffer }) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.onclose?.();
  }

  // 테스트 헬퍼
  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  receiveEvent(event: ServerEvent): void {
    this.onmessage?.({ data: JSON.stringify(event) });
  }

  receiveFramePacket(engineCode: number, jpegBytes: number[]): void {
    this.onmessage?.({ data: new Uint8Array([engineCode, ...jpegBytes]).buffer });
  }
}

const helloEvent: ServerEvent = {
  type: 'hello',
  url: 'http://localhost:3000',
  device: 'iPhone 15',
  engines: ['chromium', 'webkit'],
  viewport: { width: 390, height: 844 },
};

describe('useCrosspaneSocket', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('hello를 받으면 엔진 상태를 starting으로 초기화한다', () => {
    const { result } = renderHook(() => useCrosspaneSocket());
    const socket = FakeWebSocket.instances[0];

    act(() => socket.receiveEvent(helloEvent));

    expect(result.current.hello?.engines).toEqual(['chromium', 'webkit']);
    expect(result.current.engineStates.chromium?.status).toBe('starting');
    expect(result.current.engineStates.webkit?.status).toBe('starting');
  });

  it('engine-status를 받으면 해당 엔진 상태가 갱신된다', () => {
    const { result } = renderHook(() => useCrosspaneSocket());
    const socket = FakeWebSocket.instances[0];

    act(() => {
      socket.receiveEvent(helloEvent);
      socket.receiveEvent({ type: 'engine-status', engine: 'chromium', status: 'ready' });
    });

    expect(result.current.engineStates.chromium?.status).toBe('ready');
    expect(result.current.engineStates.webkit?.status).toBe('starting');
  });

  it('바이너리 프레임 패킷이 구독자에게 ImageBitmap으로 전달된다', async () => {
    const fakeBitmap = { width: 390, height: 844, close: vi.fn() };
    const createImageBitmapMock = vi.fn(async () => fakeBitmap);
    vi.stubGlobal('createImageBitmap', createImageBitmapMock);

    const { result } = renderHook(() => useCrosspaneSocket());
    const socket = FakeWebSocket.instances[0];
    expect(socket.binaryType).toBe('arraybuffer');

    const receivedFrames: unknown[] = [];
    act(() => {
      result.current.subscribeToFrames('chromium', (frame) => receivedFrames.push(frame));
    });

    await act(async () => {
      socket.receiveFramePacket(0, [1, 2, 3]); // 0 = chromium
      await Promise.resolve();
    });

    expect(receivedFrames).toEqual([fakeBitmap]);
    expect(fakeBitmap.close).toHaveBeenCalled(); // 전달 후 비트맵은 해제된다
  });

  it('구독자가 없는 엔진의 프레임은 디코딩하지 않는다', async () => {
    const createImageBitmapMock = vi.fn(async () => ({ close: vi.fn() }));
    vi.stubGlobal('createImageBitmap', createImageBitmapMock);

    renderHook(() => useCrosspaneSocket());
    await act(async () => {
      FakeWebSocket.instances[0].receiveFramePacket(1, [1, 2, 3]); // webkit — 구독자 없음
      await Promise.resolve();
    });

    expect(createImageBitmapMock).not.toHaveBeenCalled();
  });

  it('console/pageerror/requestfailed가 로그로 쌓이고 clearLogs로 비운다', () => {
    const { result } = renderHook(() => useCrosspaneSocket());
    const socket = FakeWebSocket.instances[0];

    act(() => {
      socket.receiveEvent({ type: 'console', engine: 'chromium', level: 'log', text: 'hi', ts: 1 });
      socket.receiveEvent({ type: 'pageerror', engine: 'webkit', message: 'boom', ts: 2 });
      socket.receiveEvent({
        type: 'requestfailed',
        engine: 'firefox',
        url: '/api',
        error: 'timeout',
        ts: 3,
      });
    });

    expect(result.current.logs).toHaveLength(3);
    // pageerror/requestfailed는 error 레벨로 정규화된다
    expect(result.current.logs[1]).toMatchObject({ kind: 'pageerror', level: 'error' });
    expect(result.current.logs[2].text).toContain('/api');

    act(() => result.current.clearLogs());
    expect(result.current.logs).toHaveLength(0);
  });

  it('sendCommand는 소켓이 OPEN일 때만 전송한다', () => {
    const { result } = renderHook(() => useCrosspaneSocket());
    const socket = FakeWebSocket.instances[0];

    result.current.sendCommand({ type: 'reload' });
    expect(socket.sent).toHaveLength(0); // 아직 연결 전

    act(() => socket.open());
    result.current.sendCommand({ type: 'reload' });
    expect(socket.sent).toEqual([JSON.stringify({ type: 'reload' })]);
    expect(result.current.connected).toBe(true);
  });

  it('언마운트 시 소켓을 닫는다', () => {
    const { unmount } = renderHook(() => useCrosspaneSocket());
    const socket = FakeWebSocket.instances[0];
    const closeSpy = vi.spyOn(socket, 'close');

    unmount();
    expect(closeSpy).toHaveBeenCalled();
  });

  it('연결이 끊기면 자동으로 재접속한다', () => {
    vi.useFakeTimers();
    renderHook(() => useCrosspaneSocket());
    expect(FakeWebSocket.instances).toHaveLength(1);

    act(() => FakeWebSocket.instances[0].close()); // 서버 측 종료 시뮬레이션
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(FakeWebSocket.instances).toHaveLength(2);
    vi.useRealTimers();
  });
});
