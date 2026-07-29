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
