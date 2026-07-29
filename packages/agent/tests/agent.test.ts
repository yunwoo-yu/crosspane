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

  it('중복 init은 같은 에이전트를 돌려준다 (이중 후킹 방지)', () => {
    agent = initCrosspane({ label: 'first' });
    const hooked = console.log;
    const second = initCrosspane({ label: 'second' });
    // 두 번째 호출이 훅을 덧씌우지 않아야 한다 — 덧씌우면 이벤트가 중복되고
    // dispose가 한 겹만 복원해 원본이 영영 돌아오지 않는다
    expect(second).toBe(agent);
    expect(console.log).toBe(hooked);
    console.log('once');
    expect(agent.capture().events.filter((e) => e.type === 'console')).toHaveLength(1);
  });

  it('dispose 후에는 다시 init할 수 있다', () => {
    const first = initCrosspane();
    first.dispose();
    agent = initCrosspane();
    expect(agent).not.toBe(first);
    expect(agent.enabled).toBe(true);
  });

  it('거대한 콘솔 인자는 상한에서 잘리고 잘렸음을 알린다', () => {
    agent = initCrosspane({ maxTextLength: 50 });
    console.log('x'.repeat(500));
    const entry = agent.capture().events.find((e) => e.type === 'console');
    const text = entry?.type === 'console' ? entry.text : '';
    expect(text.length).toBeLessThan(120);
    expect(text).toContain('(truncated)');
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

  it('copyCapture()는 캡처 JSON을 그대로 클립보드에 싣는다', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    agent = initCrosspane({ label: 'QA 빌드' });
    console.log('hello');

    expect(await agent.copyCapture()).toBe(true);
    // 붙여 넣은 텍스트가 대시보드가 읽는 캡처 파일과 같은 모양이어야 한다
    const pasted = JSON.parse(writeText.mock.calls[0][0]);
    expect(pasted.version).toBe(1);
    expect(pasted.session.label).toBe('QA 빌드');
    expect(pasted.events.some((e: { text?: string }) => e.text === 'hello')).toBe(true);

    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
      writable: true,
    });
  });

  it('게이팅된 에이전트의 copyCapture는 false — 껐는데 성공한 척하지 않는다', async () => {
    agent = initCrosspane({ enabled: false });
    expect(await agent.copyCapture()).toBe(false);
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

describe('직렬화 예산 (핫패스 비용)', () => {
  let agent: CrosspaneAgent | null = null;
  afterEach(() => {
    agent?.dispose();
    agent = null;
  });

  it('거대한 객체를 전부 직렬화하지 않는다 (예산 초과분은 생략)', () => {
    agent = initCrosspane({ maxTextLength: 200 });
    // 예산을 한참 넘는 객체 — 뒤쪽 키는 결과에 들어오지 않아야 한다
    const huge: Record<string, string> = {};
    for (let i = 0; i < 2_000; i++) huge[`key${i}`] = 'x'.repeat(100);
    huge.sentinelAtTheEnd = 'SHOULD_NOT_APPEAR';
    console.log(huge);

    const entry = agent.capture().events.find((e) => e.type === 'console');
    const text = entry?.type === 'console' ? entry.text : '';
    expect(text).not.toContain('SHOULD_NOT_APPEAR');
    expect(text.length).toBeLessThan(400); // 예산 + 잘림 안내 수준
  });

  it('순환 참조를 던지지 않고 처리한다', () => {
    agent = initCrosspane();
    const circular: Record<string, unknown> = { name: 'loop' };
    circular.self = circular;
    expect(() => console.log(circular)).not.toThrow();
    expect(agent.capture().events.some((e) => e.type === 'console')).toBe(true);
  });

  it('Error 인자는 스택을 싣는다', () => {
    agent = initCrosspane();
    console.error(new Error('with stack'));
    const entry = agent.capture().events.find((e) => e.type === 'console');
    const text = entry?.type === 'console' ? entry.text : '';
    expect(text).toContain('with stack');
  });
});
