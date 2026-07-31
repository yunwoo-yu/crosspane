import { afterEach, describe, expect, it, vi } from 'vitest';
import { type CrosspaneAgent, initCrosspane } from '../src/index';

/**
 * 훅의 계약은 두 가지다: **원본 동작 보존**과 **dispose 원복**
 * (`.claude/rules/agent-sdk.md`). 이 파일은 fetch/console 외의 훅 —
 * XHR과 내비게이션 — 에 대해 그 두 가지를 검증한다.
 */

let agent: CrosspaneAgent | null = null;

afterEach(() => {
  agent?.dispose();
  agent = null;
  vi.restoreAllMocks();
});

function networkEvents(instance: CrosspaneAgent) {
  return instance.capture().events.filter((event) => event.type === 'network');
}

function navigationEvents(instance: CrosspaneAgent) {
  return instance.capture().events.filter((event) => event.type === 'navigation');
}

/**
 * 실제 전송만 무력화한다 — jsdom은 send()를 진짜 요청으로 보내 테스트를 느리고
 * 네트워크 의존적으로 만든다. 훅은 이 스텁을 원본으로 감싸므로 계약 검증은 그대로 유효하다.
 */
function stubTransport(): void {
  vi.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(() => {});
}

describe('XHR 훅', () => {
  it('open/send 원본을 그대로 호출한다 (인자 전달 포함)', () => {
    const open = vi.spyOn(XMLHttpRequest.prototype, 'open');
    const send = vi.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(() => {});
    agent = initCrosspane();

    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'https://api.test/pay', true);
    xhr.send('{"amount":1}');

    expect(open).toHaveBeenCalledWith('POST', 'https://api.test/pay', true);
    expect(send).toHaveBeenCalledWith('{"amount":1}');
    open.mockRestore();
    send.mockRestore();
  });

  it('loadend에서 네트워크 이벤트를 싣는다 (method·url·initiator)', () => {
    stubTransport();
    agent = initCrosspane();
    const xhr = new XMLHttpRequest();
    xhr.open('GET', 'https://api.test/items');
    xhr.send();
    // jsdom은 실제 요청을 보내지 않으므로 loadend를 직접 발생시킨다
    xhr.dispatchEvent(new Event('loadend'));

    expect(networkEvents(agent)).toEqual([
      expect.objectContaining({
        type: 'network',
        method: 'GET',
        url: 'https://api.test/items',
        initiator: 'xhr',
      }),
    ]);
  });

  it('status 0(차단·중단)은 사유를 남긴다 — 웹뷰에서 가장 안 보이는 실패다', () => {
    stubTransport();
    agent = initCrosspane();
    const xhr = new XMLHttpRequest();
    xhr.open('GET', 'https://blocked.test/x');
    xhr.send();
    xhr.dispatchEvent(new Event('loadend'));

    const [event] = networkEvents(agent);
    expect(event).toMatchObject({ status: 0, error: 'network error or aborted' });
  });

  it('open 없이 send하면 브라우저와 동일하게 던진다 (원본 동작 보존)', () => {
    agent = initCrosspane();
    const xhr = new XMLHttpRequest();
    // 훅이 예외를 삼켜 버리면 페이지의 에러 처리 흐름이 바뀐다 — 보존이 맞다
    expect(() => xhr.send()).toThrow();
    expect(networkEvents(agent)).toHaveLength(0);
  });

  it('dispose하면 prototype이 원본으로 돌아온다', () => {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    agent = initCrosspane();
    expect(XMLHttpRequest.prototype.open).not.toBe(originalOpen);

    agent.dispose();
    agent = null;
    expect(XMLHttpRequest.prototype.open).toBe(originalOpen);
    expect(XMLHttpRequest.prototype.send).toBe(originalSend);
  });

  it('dispose 후의 XHR은 이벤트를 만들지 않는다', () => {
    stubTransport();
    agent = initCrosspane();
    const captured = agent;
    captured.dispose();
    agent = null;

    const xhr = new XMLHttpRequest();
    xhr.open('GET', 'https://api.test/after-dispose');
    xhr.send();
    xhr.dispatchEvent(new Event('loadend'));

    const urls = networkEvents(captured).map((event) =>
      event.type === 'network' ? event.url : '',
    );
    expect(urls).not.toContain('https://api.test/after-dispose');
  });
});

describe('내비게이션 훅', () => {
  it('진입을 첫 내비게이션으로 기록한다 (리플레이의 시작점)', () => {
    agent = initCrosspane();
    expect(navigationEvents(agent)).toHaveLength(1);
  });

  it('pushState/replaceState를 SPA 라우팅으로 기록하고 원본을 호출한다', () => {
    agent = initCrosspane();

    history.pushState({}, '', '/checkout');
    expect(location.pathname).toBe('/checkout'); // 원본이 실제로 수행됐다
    history.replaceState({}, '', '/checkout/confirm');
    expect(location.pathname).toBe('/checkout/confirm');

    const urls = navigationEvents(agent).map((event) =>
      event.type === 'navigation' ? new URL(event.url).pathname : '',
    );
    expect(urls).toEqual(['/', '/checkout', '/checkout/confirm']);
  });

  it('popstate(뒤로가기)도 기록한다', () => {
    agent = initCrosspane();
    window.dispatchEvent(new Event('popstate'));
    expect(navigationEvents(agent)).toHaveLength(2);
  });

  it('init→dispose를 반복해도 원본이 그대로 복원된다 (래퍼 누적 없음)', () => {
    // 회귀: 예전 구현은 `history.pushState.bind(history)`를 원본으로 저장해
    // dispose가 래퍼를 되돌렸고, 사이클마다 bind 층이 영구히 쌓였다
    // (HMR·중복 init 환경에서 실제로 발생하는 오염)
    const originalPush = history.pushState;
    const originalReplace = history.replaceState;

    for (let i = 0; i < 3; i++) {
      const cycle = initCrosspane();
      cycle.dispose();
    }

    expect(history.pushState).toBe(originalPush);
    expect(history.replaceState).toBe(originalReplace);
  });

  it('dispose하면 history 메서드와 popstate 리스너가 원복된다', () => {
    const originalPush = history.pushState;
    agent = initCrosspane();
    expect(history.pushState).not.toBe(originalPush);

    const captured = agent;
    captured.dispose();
    agent = null;

    expect(history.pushState).toBe(originalPush);
    const before = navigationEvents(captured).length;
    history.pushState({}, '', '/after-dispose');
    window.dispatchEvent(new Event('popstate'));
    expect(navigationEvents(captured)).toHaveLength(before);
  });
});

describe('captureBodies (옵트인)', () => {
  it('응답 바디를 clone으로 읽어 페이지의 스트림 소비를 방해하지 않는다', async () => {
    // rules의 핵심 불변식: 원본 body를 소비하면 페이지가 응답을 못 읽는다
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    agent = initCrosspane({ captureBodies: true });

    const response = await fetch('https://api.test/data');
    // 페이지가 여전히 바디를 읽을 수 있어야 한다
    await expect(response.text()).resolves.toBe('{"ok":true}');

    const [event] = networkEvents(agent);
    expect(event).toMatchObject({ bodyPreview: '{"ok":true}', bodyTruncated: false });
    fetchSpy.mockRestore();
  });

  it('상한을 넘는 바디는 자르고 잘렸음을 표시한다', async () => {
    const long = 'x'.repeat(50);
    const fetchSpy = vi.spyOn(window, 'fetch').mockResolvedValue(new Response(long));
    agent = initCrosspane({ captureBodies: true, bodyPreviewLimit: 10 });

    await fetch('https://api.test/long');

    const [event] = networkEvents(agent);
    expect(event).toMatchObject({ bodyPreview: 'x'.repeat(10), bodyTruncated: true });
    fetchSpy.mockRestore();
  });

  it('기본값은 꺼져 있다 (프라이버시 안전 기본값)', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockResolvedValue(new Response('secret'));
    agent = initCrosspane();

    await fetch('https://api.test/data');

    const [event] = networkEvents(agent);
    expect(event).not.toHaveProperty('bodyPreview', 'secret');
    expect((event as { bodyPreview?: string }).bodyPreview).toBeUndefined();
    fetchSpy.mockRestore();
  });
});

describe('exportFile', () => {
  it('라벨을 파일명으로 정제하고 확장자를 붙인다', () => {
    // jsdom에는 createObjectURL이 없다 — 앵커의 download 속성만 확인하면 충분하다
    const createUrl = vi.fn().mockReturnValue('blob:stub');
    const revokeUrl = vi.fn();
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: revokeUrl });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloadName = this.download;
    });
    let downloadName = '';

    agent = initCrosspane({ label: '결제 웹뷰 · QA build' });
    agent.exportFile();

    // 한국어 라벨이 살아남아야 한다 — `\w` 정제는 이걸 통째로 '_'로 만든다
    expect(downloadName).toMatch(/^결제_웹뷰_QA_build-s-[\w-]+\.crosspane\.json$/u);
    expect(createUrl).toHaveBeenCalledOnce();
    // 누수 방지: 생성한 blob URL은 해제한다
    expect(revokeUrl).toHaveBeenCalledWith('blob:stub');
    click.mockRestore();
  });
});

/**
 * 리소스 타이밍 보강 — 훅이 못 보는 요청을 메운다.
 *
 * 이 동작이 조용히 깨지면 화면이 다시 "8건 중 1건"으로 돌아간다(실측 수치).
 * 사용자에게는 요청이 **일어나지 않은 것처럼** 보이므로, 회귀를 반드시 잡아야 한다.
 */
describe('리소스 타이밍 보강', () => {
  function stubObserver(entries: Partial<PerformanceResourceTiming>[]) {
    class StubObserver {
      constructor(private readonly callback: (list: { getEntries: () => unknown[] }) => void) {}
      observe() {
        // buffered: true 의미 — 관찰 시작 전에 쌓인 것을 즉시 넘긴다
        this.callback({ getEntries: () => entries });
      }
      disconnect() {}
    }
    vi.stubGlobal('PerformanceObserver', StubObserver);
  }

  it('훅이 못 보는 요청을 메운다 — 이미지·CSS·beacon과 init 이전 요청', () => {
    stubObserver([
      { name: '/an-image.png', initiatorType: 'img', startTime: 0, duration: 12 },
      { name: '/a-style.css', initiatorType: 'link', startTime: 1, duration: 8 },
      { name: '/a-beacon', initiatorType: 'beacon', startTime: 2, duration: 1 },
      // 에이전트가 설치되기 전에 나간 fetch — 훅은 이걸 볼 수 없었다
      { name: '/early-fetch', initiatorType: 'fetch', startTime: 3, duration: 5 },
    ]);
    agent = initCrosspane({ label: 'probe' });

    const seen = networkEvents(agent).map((event) => `${event.initiator} ${event.url}`);
    expect(seen).toContain('img /an-image.png');
    expect(seen).toContain('css /a-style.css');
    expect(seen).toContain('beacon /a-beacon');
    expect(seen).toContain('fetch /early-fetch');
  });

  it('훅 설치 이후의 fetch/xhr은 건너뛴다 — 훅 쪽이 더 정확하다', () => {
    // startTime이 설치 시각보다 뒤면 훅이 이미 보고했다는 뜻이다
    stubObserver([
      { name: '/late-fetch', initiatorType: 'fetch', startTime: 1e9, duration: 3 },
      { name: '/late-xhr', initiatorType: 'xmlhttprequest', startTime: 1e9, duration: 3 },
    ]);
    agent = initCrosspane({ label: 'probe' });

    expect(networkEvents(agent)).toHaveLength(0);
  });

  it('상태 코드를 모르면 비운다 — 0으로 채우면 실패로 읽힌다', () => {
    stubObserver([{ name: '/an-sse', initiatorType: 'other', startTime: 0, duration: 2 }]);
    agent = initCrosspane({ label: 'probe' });

    const [event] = networkEvents(agent);
    expect(event.status).toBeUndefined();
    expect(event.observed).toBe(true);
  });

  it('허브로 가는 우리 자신의 통신은 보고하지 않는다 — 관찰이 관찰을 낳는다', () => {
    stubObserver([
      { name: 'http://localhost:7788/agent', initiatorType: 'other', startTime: 0, duration: 1 },
    ]);
    agent = initCrosspane({ label: 'probe' });

    expect(networkEvents(agent)).toHaveLength(0);
  });

  it('PerformanceObserver가 없어도 죽지 않는다', () => {
    vi.stubGlobal('PerformanceObserver', undefined);
    expect(() => {
      agent = initCrosspane({ label: 'probe' });
    }).not.toThrow();
  });
});

/**
 * 상호작용 기록 — "무엇을 눌렀더니"가 없으면 로그는 원인 없는 결과의 나열이다.
 *
 * 가장 중요한 계약은 **사용자가 친 값을 담지 않는 것**이다. 이게 깨지면 이 툴은
 * 비밀번호 유출 경로가 된다 (`.claude/rules/agent-sdk.md`).
 */
describe('상호작용', () => {
  function interactions(instance: CrosspaneAgent) {
    return instance.capture().events.filter((event) => event.type === 'interaction');
  }

  it('클릭 대상을 사람이 알아볼 수 있게 적는다', () => {
    agent = initCrosspane({ label: 'probe' });
    const button = document.createElement('button');
    button.id = 'pay';
    button.className = 'primary large';
    button.textContent = '결제하기';
    document.body.append(button);

    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const [event] = interactions(agent);
    expect(event.kind).toBe('click');
    expect(event.target).toBe('button#pay.primary.large "결제하기"');
    button.remove();
  });

  it('입력 값은 담지 않고 길이만 담는다 — 비밀번호가 새면 안 된다', () => {
    agent = initCrosspane({ label: 'probe' });
    const input = document.createElement('input');
    input.type = 'password';
    document.body.append(input);
    input.value = 'hunter2-secret';

    input.dispatchEvent(new Event('input', { bubbles: true }));

    const [event] = interactions(agent);
    expect(event.valueLength).toBe('hunter2-secret'.length);
    expect(JSON.stringify(agent.capture())).not.toContain('hunter2-secret');
    input.remove();
  });

  it('문자 키는 담지 않는다 — 이어 붙이면 타이핑한 내용이 복원된다', () => {
    agent = initCrosspane({ label: 'probe' });
    for (const key of ['h', 'i', 'Enter']) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    }

    const keys = interactions(agent).map((event) => event.key);
    expect(keys).toEqual(['Enter']);
  });

  it('dispose가 리스너를 떼어낸다', () => {
    agent = initCrosspane({ label: 'probe' });
    const instance = agent;
    instance.dispose();
    document.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(interactions(instance)).toHaveLength(0);
    agent = null;
  });
});

/** 렌더링·응답성 지표 — 웹뷰에서 "왜 느리지"에 손댈 수 있게 하는 부분 */
describe('성능 지표', () => {
  function vitals(instance: CrosspaneAgent) {
    return instance.capture().events.filter((event) => event.type === 'vital');
  }

  /**
   * 엔트리 모양이 지표마다 다르다 (layout-shift의 value/hadRecentInput, event의 duration…).
   * `Partial<PerformanceEntry>`로 좁히면 그 필드들이 타입에 없다 — 스텁은 넓게 받는다.
   */
  function stubVitalObserver(byType: Record<string, Record<string, unknown>[]>) {
    class StubObserver {
      constructor(private readonly callback: (list: { getEntries: () => unknown[] }) => void) {}
      observe({ type }: { type: string }) {
        const entries = byType[type];
        // 브라우저가 모르는 타입은 실제로 던진다 — 그 경로도 여기서 재현한다
        if (entries === undefined) throw new TypeError(`unknown type ${type}`);
        this.callback({ getEntries: () => entries });
      }
      disconnect() {}
    }
    vi.stubGlobal('PerformanceObserver', StubObserver);
  }

  it('LCP·CLS·longtask를 기록하고 나쁜 값만 눈에 띄게 한다', () => {
    stubVitalObserver({
      'largest-contentful-paint': [{ startTime: 3200 }],
      'layout-shift': [{ value: 0.25, hadRecentInput: false }],
      longtask: [{ duration: 120 }],
    });
    agent = initCrosspane({ label: 'probe' });

    const seen = vitals(agent).map((event) => `${event.name} ${event.value}`);
    expect(seen).toContain('LCP 3200');
    expect(seen).toContain('CLS 0.25');
    expect(seen).toContain('longtask 120');
  });

  it('사용자 입력 직후의 레이아웃 이동은 세지 않는다 — CLS의 정의가 그렇다', () => {
    stubVitalObserver({ 'layout-shift': [{ value: 0.5, hadRecentInput: true }] });
    agent = initCrosspane({ label: 'probe' });

    expect(vitals(agent)).toHaveLength(0);
  });

  it('빠른 상호작용은 보내지 않는다 — 전부 보내면 회선을 잠식한다', () => {
    stubVitalObserver({ event: [{ duration: 40, name: 'click' }] });
    agent = initCrosspane({ label: 'probe' });

    expect(vitals(agent)).toHaveLength(0);
  });

  it('PerformanceObserver가 없으면 조용히 건너뛴다', () => {
    vi.stubGlobal('PerformanceObserver', undefined);
    expect(() => {
      agent = initCrosspane({ label: 'probe' });
    }).not.toThrow();
  });
});

describe('지표 중복', () => {
  it('페이지당 한 번뿐인 지표는 두 번 오더라도 한 번만 낸다', () => {
    // buffered:true로 관찰을 시작하면 브라우저가 같은 navigation 엔트리를 두 번 주는
    // 경우가 있다(실측). 그대로 내면 타임라인에 TTFB가 두 줄로 찍혀 지표를 믿을 수 없다
    class StubObserver {
      constructor(private readonly callback: (list: { getEntries: () => unknown[] }) => void) {}
      observe({ type }: { type: string }) {
        if (type === 'navigation') {
          const entry = { responseStart: 8 };
          this.callback({ getEntries: () => [entry] });
          this.callback({ getEntries: () => [entry] });
          return;
        }
        throw new TypeError('unsupported');
      }
      disconnect() {}
    }
    vi.stubGlobal('PerformanceObserver', StubObserver);
    agent = initCrosspane({ label: 'probe' });

    const ttfb = agent.capture().events.filter((e) => e.type === 'vital' && e.name === 'TTFB');
    expect(ttfb).toHaveLength(1);
  });

  it('여러 번 발생하는 것이 정상인 지표는 막지 않는다', () => {
    class StubObserver {
      constructor(private readonly callback: (list: { getEntries: () => unknown[] }) => void) {}
      observe({ type }: { type: string }) {
        if (type === 'longtask') {
          this.callback({ getEntries: () => [{ duration: 80 }, { duration: 120 }] });
          return;
        }
        throw new TypeError('unsupported');
      }
      disconnect() {}
    }
    vi.stubGlobal('PerformanceObserver', StubObserver);
    agent = initCrosspane({ label: 'probe' });

    const tasks = agent.capture().events.filter((e) => e.type === 'vital' && e.name === 'longtask');
    expect(tasks).toHaveLength(2);
  });
});
