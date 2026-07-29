import type { SessionEvent, SessionMeta } from '@crosspane/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveTransport } from '../src/transport';

/** jsdom에는 WebSocket이 없다 — 전송 내용을 검사할 수 있는 최소 대역 */
class FakeSocket {
  static instances: FakeSocket[] = [];
  static OPEN = 1;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  sent: string[] = [];

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  send(payload: string): void {
    this.sent.push(payload);
  }

  close = vi.fn(() => {
    this.readyState = 3;
    this.onclose?.();
  });

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
}

const session: SessionMeta = {
  id: 's-1',
  label: 'test',
  userAgent: 'ua',
  startedAt: 0,
};

const event = (text: string): SessionEvent => ({
  type: 'console',
  sessionId: 's-1',
  level: 'log',
  text,
  ts: 0,
});

describe('LiveTransport', () => {
  let transport: LiveTransport | null = null;

  beforeEach(() => {
    FakeSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.useFakeTimers();
  });

  afterEach(() => {
    transport?.dispose();
    transport = null;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const latest = () => FakeSocket.instances[FakeSocket.instances.length - 1];
  const parseSent = (socket: FakeSocket) => socket.sent.map((raw) => JSON.parse(raw));

  it('http(s) 주소를 ws(s)로 바꾸고 /agent에 붙는다', () => {
    transport = new LiveTransport('http://192.168.0.10:7788', session);
    transport.connect();
    expect(latest().url).toBe('ws://192.168.0.10:7788/agent');
  });

  it('연결되면 register를 먼저 보낸다', () => {
    transport = new LiveTransport('http://hub', session);
    transport.connect();
    latest().open();
    expect(parseSent(latest())[0]).toEqual({ type: 'register', session });
  });

  it('이벤트를 배칭해 한 메시지로 보낸다 (건당 전송 금지)', () => {
    transport = new LiveTransport('http://hub', session, 300);
    transport.connect();
    latest().open();
    transport.enqueue(event('a'));
    transport.enqueue(event('b'));
    expect(parseSent(latest())).toHaveLength(1); // register만

    vi.advanceTimersByTime(300);
    const messages = parseSent(latest());
    expect(messages[1].type).toBe('events');
    expect(messages[1].events.map((e: SessionEvent) => (e as { text: string }).text)).toEqual([
      'a',
      'b',
    ]);
  });

  it('연결 전 이벤트는 큐에 남았다가 연결되면 전송된다', () => {
    transport = new LiveTransport('http://hub', session, 300);
    transport.connect();
    transport.enqueue(event('early'));
    vi.advanceTimersByTime(300);
    expect(parseSent(latest())).toHaveLength(0); // 아직 미연결

    latest().open(); // onopen이 register + flush
    const messages = parseSent(latest());
    expect(messages[0].type).toBe('register');
    expect(messages[1].events[0].text).toBe('early');
  });

  it('큐 상한을 넘으면 오래된 이벤트를 버린다 (서버 부재 시 무한 성장 방지)', () => {
    transport = new LiveTransport('http://hub', session, 300, 2);
    transport.connect();
    transport.enqueue(event('1'));
    transport.enqueue(event('2'));
    transport.enqueue(event('3'));
    latest().open();
    const events = parseSent(latest())[1].events;
    expect(events.map((e: { text: string }) => e.text)).toEqual(['2', '3']);
  });

  it('끊기면 백오프로 재접속한다', () => {
    transport = new LiveTransport('http://hub', session);
    transport.connect();
    latest().open();
    const before = FakeSocket.instances.length;
    latest().onclose?.();
    vi.advanceTimersByTime(1_000);
    expect(FakeSocket.instances.length).toBe(before + 1);
  });

  it('dispose 후에는 재접속하지 않는다', () => {
    transport = new LiveTransport('http://hub', session);
    transport.connect();
    latest().open();
    transport.dispose();
    const after = FakeSocket.instances.length;
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances.length).toBe(after);
    transport = null;
  });

  it('WebSocket 생성이 던져도 페이지에 전파되지 않는다', () => {
    vi.stubGlobal(
      'WebSocket',
      class {
        constructor() {
          throw new Error('blocked by CSP');
        }
      },
    );
    transport = new LiveTransport('http://hub', session);
    expect(() => transport?.connect()).not.toThrow();
  });
});
