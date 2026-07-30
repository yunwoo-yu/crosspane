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

  /** 보낸 payload에서 이벤트만 평탄화 — register 메시지는 건너뛴다 */
  sentEvents(): SessionEvent[] {
    return this.sent
      .map((payload) => JSON.parse(payload) as { type: string; events?: SessionEvent[] })
      .filter((message) => message.type === 'events')
      .flatMap((message) => message.events ?? []);
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

  describe('연속 중복 합치기', () => {
    it('보내기 전 큐에서 같은 이벤트를 합친다 (허브 히스토리 보호 + 회선 절약)', () => {
      transport = new LiveTransport('http://hub.test', session, 10);
      transport.connect();
      const socket = FakeSocket.instances[0];
      socket.open();

      for (let i = 0; i < 500; i++) {
        transport.enqueue({
          type: 'console',
          sessionId: 's-1',
          level: 'error',
          text: 'spam',
          ts: 1,
        });
      }
      vi.advanceTimersByTime(20);

      const events = socket.sentEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ text: 'spam', repeat: 500 });
    });

    it('이미 보낸 것은 건드리지 않는다 — 플러시 뒤 런은 새 이벤트로 시작한다', () => {
      transport = new LiveTransport('http://hub.test', session, 10);
      transport.connect();
      const socket = FakeSocket.instances[0];
      socket.open();

      const spam = () =>
        transport?.enqueue({
          type: 'console',
          sessionId: 's-1',
          level: 'error',
          text: 'spam',
          ts: 1,
        });
      for (let i = 0; i < 3; i++) spam();
      vi.advanceTimersByTime(20);
      for (let i = 0; i < 2; i++) spam();
      vi.advanceTimersByTime(20);

      // 보낸 이벤트를 나중에 고치면 대시보드가 이미 받은 수와 이중으로 세어진다
      const repeats = socket.sentEvents().map((event) => (event as { repeat?: number }).repeat);
      expect(repeats).toEqual([3, 2]);
    });
  });

  describe('접속 토큰', () => {
    it('serverUrl의 쿼리를 /agent 로 옮긴다 — 노출된 허브는 토큰을 요구한다', () => {
      transport = new LiveTransport('http://192.168.0.10:7788/?t=abc123', session);
      transport.connect();
      expect(FakeSocket.instances[0].url).toBe('ws://192.168.0.10:7788/agent?t=abc123');
    });

    it('토큰이 없으면 예전과 같은 주소를 쓴다', () => {
      transport = new LiveTransport('http://192.168.0.10:7788', session);
      transport.connect();
      expect(FakeSocket.instances[0].url).toBe('ws://192.168.0.10:7788/agent');
    });

    it('https는 wss로 바꾼다', () => {
      transport = new LiveTransport('https://hub.test/?t=x', session);
      transport.connect();
      expect(FakeSocket.instances[0].url).toBe('wss://hub.test/agent?t=x');
    });

    it('파싱 불가한 serverUrl에도 페이지가 죽지 않는다', () => {
      transport = new LiveTransport('not a url', session);
      expect(() => transport?.connect()).not.toThrow();
    });

    it('경로 접두사를 유지한다 — 리버스 프록시 뒤의 허브 (https 페이지의 실제 경로)', () => {
      // 접두사를 버리면 프록시가 /agent를 매칭하지 못해 조용히 실패한다
      transport = new LiveTransport('https://staging.example.com/__crosspane', session);
      transport.connect();
      expect(FakeSocket.instances[0].url).toBe('wss://staging.example.com/__crosspane/agent');
    });

    it('경로 접두사 + 토큰을 함께 유지한다', () => {
      transport = new LiveTransport('https://staging.example.com/__crosspane/?t=abc', session);
      transport.connect();
      expect(FakeSocket.instances[0].url).toBe('wss://staging.example.com/__crosspane/agent?t=abc');
    });

    it('끝 슬래시가 //agent 를 만들지 않는다', () => {
      transport = new LiveTransport('http://192.168.0.10:7788/', session);
      transport.connect();
      expect(FakeSocket.instances[0].url).toBe('ws://192.168.0.10:7788/agent');
    });
  });
});
