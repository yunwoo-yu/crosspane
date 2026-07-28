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

  receiveFramePacket(engineCode: number, scrollY: number, jpegBytes: number[]): void {
    // 패킷 v3: [type=FRAME(1)][engine][flags][scrollY i32LE][JPEG]
    const packet = new Uint8Array(7 + jpegBytes.length);
    packet[0] = 1;
    packet[1] = engineCode;
    packet[2] = 0;
    new DataView(packet.buffer).setInt32(3, scrollY, true);
    packet.set(jpegBytes, 7);
    this.onmessage?.({ data: packet.buffer } as MessageEvent<ArrayBuffer>);
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
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** 로그/네트워크는 EVENT_BATCH_MS 배칭 — 단언 전에 플러시 */
  const flushBatch = () => act(() => vi.advanceTimersByTime(60));

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
      // 셸 성공 시 ios-sim이 인터랙티브로 전환되는 동적 viewOnly
      socket.receiveEvent({
        type: 'engine-status',
        engine: 'webkit',
        status: 'ready',
        viewOnly: false,
      });
    });

    expect(result.current.engineStates.chromium?.status).toBe('ready');
    expect(result.current.engineStates.chromium?.viewOnly).toBeUndefined();
    expect(result.current.engineStates.webkit?.viewOnly).toBe(false);
  });

  it('바이너리 프레임 패킷이 구독자에게 ImageBitmap으로 전달된다', async () => {
    const fakeBitmap = { width: 390, height: 844, close: vi.fn() };
    const createImageBitmapMock = vi.fn(async () => fakeBitmap);
    vi.stubGlobal('createImageBitmap', createImageBitmapMock);

    const { result } = renderHook(() => useCrosspaneSocket());
    const socket = FakeWebSocket.instances[0];
    expect(socket.binaryType).toBe('arraybuffer');

    const receivedFrames: unknown[] = [];
    const receivedScrollYs: number[] = [];
    act(() => {
      result.current.subscribeToFrames('chromium', (frame, scrollY) => {
        receivedFrames.push(frame);
        receivedScrollYs.push(scrollY);
      });
    });

    await act(async () => {
      socket.receiveFramePacket(0, 320, [1, 2, 3]); // 0 = chromium
      await Promise.resolve();
    });

    expect(receivedFrames).toEqual([fakeBitmap]);
    expect(receivedScrollYs).toEqual([320]); // 헤더의 scrollY가 함께 전달된다
    expect(fakeBitmap.close).toHaveBeenCalled(); // 전달 후 비트맵은 해제된다
  });

  it('구독자가 없는 엔진의 프레임은 디코딩하지 않는다', async () => {
    const createImageBitmapMock = vi.fn(async () => ({ close: vi.fn() }));
    vi.stubGlobal('createImageBitmap', createImageBitmapMock);

    renderHook(() => useCrosspaneSocket());
    await act(async () => {
      FakeWebSocket.instances[0].receiveFramePacket(1, 0, [1, 2, 3]); // webkit — 구독자 없음
      await Promise.resolve();
    });

    expect(createImageBitmapMock).not.toHaveBeenCalled();
  });

  it('navigation 이벤트가 현재 URL을 갱신하고 구분선 로그를 남긴다', () => {
    const { result } = renderHook(() => useCrosspaneSocket());
    const socket = FakeWebSocket.instances[0];

    act(() => {
      socket.receiveEvent(helloEvent);
      socket.receiveEvent({
        type: 'navigation',
        engine: 'chromium',
        url: 'http://localhost:3000/detail',
        ts: 1,
      });
    });

    expect(result.current.engineStates.chromium?.currentUrl).toBe('http://localhost:3000/detail');
    flushBatch();
    expect(result.current.logs[0]).toMatchObject({ kind: 'navigation', engine: 'chromium' });
  });

  it('network 이벤트가 networkEntries로 쌓이고 clearLogs로 함께 비워진다', () => {
    const { result } = renderHook(() => useCrosspaneSocket());
    const socket = FakeWebSocket.instances[0];

    act(() => {
      socket.receiveEvent({
        type: 'network',
        engine: 'chromium',
        method: 'GET',
        url: 'http://localhost:3000/api/me',
        status: 200,
        resourceType: 'fetch',
        durationMs: 12,
        ts: 1,
      });
    });

    flushBatch();
    expect(result.current.networkEntries).toHaveLength(1);
    expect(result.current.networkEntries[0]).toMatchObject({ status: 200, method: 'GET' });

    act(() => result.current.clearLogs());
    expect(result.current.networkEntries).toHaveLength(0);
  });

  it('httperror 이벤트가 상태코드와 함께 에러 로그로 쌓인다', () => {
    const { result } = renderHook(() => useCrosspaneSocket());
    const socket = FakeWebSocket.instances[0];

    act(() => {
      socket.receiveEvent({
        type: 'httperror',
        engine: 'webkit',
        url: 'http://localhost:3000/api/reservations',
        status: 500,
        ts: 1,
      });
    });

    flushBatch();
    expect(result.current.logs[0]).toMatchObject({ kind: 'httperror', level: 'error' });
    expect(result.current.logs[0].text).toContain('HTTP 500');
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

    flushBatch();
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
    // 연결 직후에는 시청 엔진 목록(watch)이 먼저 전송된다
    expect(socket.sent).toEqual([JSON.stringify({ type: 'watch', engines: [] })]);
    result.current.sendCommand({ type: 'reload' });
    expect(socket.sent[1]).toBe(JSON.stringify({ type: 'reload' }));
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
    renderHook(() => useCrosspaneSocket());
    expect(FakeWebSocket.instances).toHaveLength(1);

    act(() => FakeWebSocket.instances[0].close()); // 서버 측 종료 시뮬레이션
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('navigation이 engine-status의 viewOnly/detail을 지우지 않는다 (셸 모드 유지)', () => {
    const { result } = renderHook(() => useCrosspaneSocket());
    const socket = FakeWebSocket.instances[0];

    act(() => {
      socket.receiveEvent({
        type: 'engine-status',
        engine: 'ios-sim',
        status: 'ready',
        detail: 'iPhone · WKWebView',
        viewOnly: false,
      });
      // 서버 재생 순서상 navigation이 status 뒤에 온다 — 이때 상태가 보존돼야 한다
      socket.receiveEvent({
        type: 'navigation',
        engine: 'ios-sim',
        url: 'http://localhost:3000/',
        ts: 1,
      });
    });
    expect(result.current.engineStates['ios-sim']).toMatchObject({
      status: 'ready',
      viewOnly: false,
      detail: 'iPhone · WKWebView',
      currentUrl: 'http://localhost:3000/',
    });
  });

  it('재접속 시 서버 히스토리 재생이 로그를 중복 누적시키지 않는다', () => {
    const { result } = renderHook(() => useCrosspaneSocket());
    const first = FakeWebSocket.instances[0];

    // 1차 세션: hello + 히스토리
    act(() => {
      first.receiveEvent(helloEvent);
      first.receiveEvent({ type: 'console', engine: 'chromium', level: 'log', text: 'a', ts: 1 });
    });
    flushBatch();
    expect(result.current.logs).toHaveLength(1);

    // 끊김 → 재접속: 서버는 접속마다 hello 후 같은 히스토리를 전량 재생한다
    act(() => first.close());
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    const second = FakeWebSocket.instances[1];
    act(() => {
      second.receiveEvent(helloEvent);
      second.receiveEvent({ type: 'console', engine: 'chromium', level: 'log', text: 'a', ts: 1 });
    });
    flushBatch();
    expect(result.current.logs).toHaveLength(1); // 중복 누적 없음 (hello가 세션 경계)
  });

  it('이전 소켓의 늦은 close가 새 소켓의 connected를 덮어쓰지 않는다', () => {
    const { result } = renderHook(() => useCrosspaneSocket());
    const first = FakeWebSocket.instances[0];

    act(() => first.close());
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    const second = FakeWebSocket.instances[1];
    act(() => second.open());
    expect(result.current.connected).toBe(true);

    // 좀비가 된 1차 소켓의 close 이벤트가 늦게 도착해도 무시된다
    act(() => first.close());
    expect(result.current.connected).toBe(true);
  });

  it('이벤트 폭주 시 배칭 — 여러 이벤트가 한 번의 상태 반영으로 묶인다', () => {
    const { result } = renderHook(() => useCrosspaneSocket());
    const socket = FakeWebSocket.instances[0];

    act(() => {
      for (let i = 0; i < 50; i++) {
        socket.receiveEvent({
          type: 'console',
          engine: 'chromium',
          level: 'log',
          text: `t${i}`,
          ts: i,
        });
      }
    });
    expect(result.current.logs).toHaveLength(0); // 플러시 전에는 반영 안 됨
    flushBatch();
    expect(result.current.logs).toHaveLength(50);
  });
});
