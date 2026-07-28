import { afterEach, describe, expect, it, vi } from 'vitest';
import { RingBuffer } from '../src/buffer';
import { type CrosspaneAgent, initCrosspane } from '../src/index';

describe('RingBuffer', () => {
  it('상한을 넘으면 오래된 것부터 버리고 드롭 수를 센다', () => {
    const buffer = new RingBuffer(3);
    for (let i = 0; i < 5; i++) {
      buffer.push({ type: 'console', sessionId: 's', level: 'log', text: String(i), ts: i });
    }
    const texts = buffer.snapshot().map((e) => (e.type === 'console' ? e.text : ''));
    expect(texts).toEqual(['2', '3', '4']);
    expect(buffer.droppedCount).toBe(2);
  });
});

describe('initCrosspane', () => {
  let agent: CrosspaneAgent | null = null;
  afterEach(() => {
    agent?.dispose();
    agent = null;
  });

  it('enabled=false면 아무것도 설치하지 않는다 (게이팅)', () => {
    const originalLog = console.log;
    agent = initCrosspane({ enabled: false });
    expect(agent.enabled).toBe(false);
    expect(console.log).toBe(originalLog);
    expect(agent.capture().events).toEqual([]);
  });

  it('console 호출을 캡처하고 원본 동작을 보존한다', () => {
    agent = initCrosspane({ label: 'test' });
    console.log('hello', { a: 1 });
    console.warn('careful');
    const events = agent.capture().events;
    const consoles = events.filter((e) => e.type === 'console');
    expect(consoles).toHaveLength(2);
    expect(consoles[0]).toMatchObject({ level: 'log', text: 'hello {"a":1}' });
    expect(consoles[1]).toMatchObject({ level: 'warning', text: 'careful' });
  });

  it('dispose하면 훅이 원복된다', () => {
    const originalLog = console.log;
    agent = initCrosspane();
    expect(console.log).not.toBe(originalLog);
    agent.dispose();
    expect(console.log).toBe(originalLog);
    agent = null;
  });

  it('fetch 성공/실패를 네트워크 이벤트로 기록한다', async () => {
    const okResponse = new Response('{"ok":true}', { status: 200 });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes('fail')) throw new TypeError('Failed to fetch');
        return okResponse;
      }),
    );
    agent = initCrosspane();
    await fetch('http://api.test/ok');
    await fetch('http://api.test/fail').catch(() => undefined);
    const network = agent.capture().events.filter((e) => e.type === 'network');
    expect(network).toHaveLength(2);
    expect(network[0]).toMatchObject({ url: 'http://api.test/ok', status: 200 });
    expect(network[1]).toMatchObject({ url: 'http://api.test/fail', status: 0 });
    expect(network[1].type === 'network' && network[1].error).toContain('Failed to fetch');
    vi.unstubAllGlobals();
  });

  it('capture()는 유효한 SessionCapture를 만든다 (버전/세션/이벤트)', () => {
    agent = initCrosspane({ label: 'QA 빌드' });
    console.log('x');
    const capture = agent.capture();
    expect(capture.version).toBe(1);
    expect(capture.session.label).toBe('QA 빌드');
    expect(capture.session.id).toMatch(/^s-/);
    // 첫 이벤트는 진입 내비게이션 — 리플레이의 시작점
    expect(capture.events[0]).toMatchObject({ type: 'navigation' });
  });

  it('unhandledrejection을 pageerror로 기록한다', async () => {
    agent = initCrosspane();
    // jsdom에는 PromiseRejectionEvent 생성자가 없다 — reason만 실어 보낸다
    const event = new Event('unhandledrejection') as Event & { reason: unknown };
    event.reason = new Error('boom');
    window.dispatchEvent(event);
    const errors = agent.capture().events.filter((e) => e.type === 'pageerror');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ message: 'Unhandled rejection: boom' });
  });
});
