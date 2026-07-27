import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCrosspaneSocket } from '../src/hooks/useCrosspaneSocket';
import type { ServerMessage } from '../src/types';

/** 네트워크 없이 서버 메시지를 주입할 수 있는 WebSocket 대역 */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly OPEN = 1;

  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;

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

  receive(msg: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

const helloMsg: ServerMessage = {
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
    const ws = FakeWebSocket.instances[0];

    act(() => ws.receive(helloMsg));

    expect(result.current.hello?.engines).toEqual(['chromium', 'webkit']);
    expect(result.current.engines.chromium?.status).toBe('starting');
    expect(result.current.engines.webkit?.status).toBe('starting');
  });

  it('frame을 받으면 해당 엔진이 ready가 되고 프레임이 저장된다', () => {
    const { result } = renderHook(() => useCrosspaneSocket());
    const ws = FakeWebSocket.instances[0];

    act(() => {
      ws.receive(helloMsg);
      ws.receive({ type: 'frame', engine: 'chromium', data: 'base64data' });
    });

    expect(result.current.engines.chromium).toMatchObject({
      status: 'ready',
      frame: 'base64data',
    });
    expect(result.current.engines.webkit?.status).toBe('starting');
  });

  it('console/pageerror/requestfailed가 로그로 쌓이고 clearLogs로 비운다', () => {
    const { result } = renderHook(() => useCrosspaneSocket());
    const ws = FakeWebSocket.instances[0];

    act(() => {
      ws.receive({ type: 'console', engine: 'chromium', level: 'log', text: 'hi', ts: 1 });
      ws.receive({ type: 'pageerror', engine: 'webkit', message: 'boom', ts: 2 });
      ws.receive({
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

  it('send는 소켓이 OPEN일 때만 전송한다', () => {
    const { result } = renderHook(() => useCrosspaneSocket());
    const ws = FakeWebSocket.instances[0];

    result.current.send({ type: 'reload' });
    expect(ws.sent).toHaveLength(0); // 아직 연결 전

    act(() => ws.open());
    result.current.send({ type: 'reload' });
    expect(ws.sent).toEqual([JSON.stringify({ type: 'reload' })]);
    expect(result.current.connected).toBe(true);
  });

  it('언마운트 시 소켓을 닫는다', () => {
    const { unmount } = renderHook(() => useCrosspaneSocket());
    const ws = FakeWebSocket.instances[0];
    const closeSpy = vi.spyOn(ws, 'close');

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
