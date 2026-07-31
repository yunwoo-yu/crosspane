import type { SessionEvent } from '@crosspane/protocol';
import { serializeArgs } from './serialize.js';

export interface HookOptions {
  sessionId: string;
  emit: (event: SessionEvent) => void;
  /** 네트워크 응답 바디 수집 (기본 꺼짐 — 프라이버시 안전 기본값) */
  captureBodies: boolean;
  bodyPreviewLimit: number;
  /** 콘솔/에러 텍스트 1건 상한 — 거대 객체 로그가 버퍼·회선을 잠식하는 것을 막는다 */
  maxTextLength: number;
}

/** 훅 해제 함수 목록을 돌려준다 — dispose 시 원본 복원 */
export function installHooks(options: HookOptions): (() => void)[] {
  const teardowns: (() => void)[] = [];
  teardowns.push(hookConsole(options));
  teardowns.push(hookErrors(options));
  teardowns.push(hookFetch(options));
  teardowns.push(hookXhr(options));
  teardowns.push(hookNavigation(options));
  // 마지막에 설치한다 — 위 훅들의 설치 시각을 기준으로 중복을 가르기 때문이다
  teardowns.push(hookResourceTiming(options));
  teardowns.push(hookInteractions(options));
  teardowns.push(hookVitals(options));
  return teardowns;
}

/** 상한을 넘으면 잘라내고 잘렸음을 알린다 — 조용히 버리면 디버깅을 오도한다 */
function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}… (truncated, ${text.length} chars)`;
}

/** 후킹 대상 console 메서드 — LogLevel(=string 포함)로 인덱싱하면 타입이 풀린다 */
const CONSOLE_LEVELS = ['log', 'info', 'warn', 'error', 'debug'] as const;
type ConsoleLevel = (typeof CONSOLE_LEVELS)[number];

function hookConsole({ sessionId, emit, maxTextLength }: HookOptions): () => void {
  const originals = new Map<ConsoleLevel, (...args: unknown[]) => void>();
  for (const level of CONSOLE_LEVELS) {
    const original = console[level] as (...args: unknown[]) => void;
    originals.set(level, original);
    (console as unknown as Record<string, unknown>)[level] = (...args: unknown[]) => {
      original.apply(console, args);
      emit({
        type: 'console',
        sessionId,
        level: level === 'warn' ? 'warning' : level,
        text: serializeArgs(args, maxTextLength),
        ts: Date.now(),
      });
    };
  }
  return () => {
    for (const [level, original] of originals) {
      (console as unknown as Record<string, unknown>)[level] = original;
    }
  };
}

function hookErrors({ sessionId, emit, maxTextLength }: HookOptions): () => void {
  const onError = (event: ErrorEvent): void => {
    emit({
      type: 'pageerror',
      sessionId,
      message: truncate(event.message, maxTextLength),
      stack:
        event.error instanceof Error ? truncate(event.error.stack ?? '', maxTextLength) : undefined,
      ts: Date.now(),
    });
  };
  const onRejection = (event: PromiseRejectionEvent): void => {
    const reason = event.reason;
    emit({
      type: 'pageerror',
      sessionId,
      message: truncate(
        `Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`,
        maxTextLength,
      ),
      stack: reason instanceof Error ? truncate(reason.stack ?? '', maxTextLength) : undefined,
      ts: Date.now(),
    });
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}

function hookFetch({ sessionId, emit, captureBodies, bodyPreviewLimit }: HookOptions): () => void {
  if (typeof window.fetch !== 'function') return () => undefined;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const started = Date.now();
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    try {
      const response = await originalFetch(input, init);
      let bodyPreview: string | undefined;
      let bodyTruncated: boolean | undefined;
      if (captureBodies) {
        // clone으로 읽어야 페이지의 스트림 소비를 방해하지 않는다
        const text = await response
          .clone()
          .text()
          .catch(() => undefined);
        if (text !== undefined) {
          bodyTruncated = text.length > bodyPreviewLimit;
          bodyPreview = text.slice(0, bodyPreviewLimit);
        }
      }
      emit({
        type: 'network',
        sessionId,
        method,
        url,
        status: response.status,
        durationMs: Date.now() - started,
        initiator: 'fetch',
        bodyPreview,
        bodyTruncated,
        ts: started,
      });
      return response;
    } catch (err) {
      emit({
        type: 'network',
        sessionId,
        method,
        url,
        status: 0,
        durationMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
        initiator: 'fetch',
        ts: started,
      });
      throw err;
    }
  };
  return () => {
    window.fetch = originalFetch;
  };
}

function hookXhr({ sessionId, emit }: HookOptions): () => void {
  const proto = XMLHttpRequest.prototype;
  const originalOpen = proto.open;
  const originalSend = proto.send;
  const meta = new WeakMap<XMLHttpRequest, { method: string; url: string; started: number }>();

  proto.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: []) {
    meta.set(this, { method, url: String(url), started: 0 });
    // biome-ignore lint/suspicious/noExplicitAny: XHR open 오버로드(async/user/password) 통과
    return (originalOpen as any).call(this, method, url, ...rest);
  } as typeof proto.open;

  proto.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const info = meta.get(this);
    if (info) {
      info.started = Date.now();
      this.addEventListener('loadend', () => {
        emit({
          type: 'network',
          sessionId,
          method: info.method,
          url: info.url,
          status: this.status,
          durationMs: Date.now() - info.started,
          error: this.status === 0 ? 'network error or aborted' : undefined,
          initiator: 'xhr',
          ts: info.started,
        });
      });
    }
    return originalSend.call(this, body);
  };

  return () => {
    proto.open = originalOpen;
    proto.send = originalSend;
  };
}

function hookNavigation({ sessionId, emit }: HookOptions): () => void {
  const emitNavigation = (): void => {
    emit({ type: 'navigation', sessionId, url: location.href, ts: Date.now() });
  };
  // bind한 함수를 저장하면 dispose가 원본이 아니라 래퍼를 되돌려, init→dispose를
  // 반복할수록 bind 층이 영구히 쌓인다 (HMR·테스트에서 실제로 발생). 원본을 그대로
  // 들고 호출 시점에 call로 this를 준다
  const originalPush = history.pushState;
  const originalReplace = history.replaceState;
  history.pushState = (...args) => {
    originalPush.call(history, ...args);
    emitNavigation();
  };
  history.replaceState = (...args) => {
    originalReplace.call(history, ...args);
    emitNavigation();
  };
  window.addEventListener('popstate', emitNavigation);
  return () => {
    history.pushState = originalPush;
    history.replaceState = originalReplace;
    window.removeEventListener('popstate', emitNavigation);
  };
}

/**
 * 브라우저가 이미 기록해 둔 리소스 타이밍으로 **훅이 못 보는 요청을 메운다.**
 *
 * 왜 필요한가 (실측): 훅은 `fetch`와 `XMLHttpRequest`만 가로챈다. 그래서 한 페이지에서
 * 일어난 요청 8건 중 대시보드에 보인 것은 1건뿐이었다 — 이미지·CSS·동적 script·
 * `sendBeacon`·`EventSource`가 통째로 빠지고, 무엇보다 **에이전트가 설치되기 전에 나간
 * 요청**(앱 부팅 시 API 호출의 전형)이 사라졌다. 화면에 없으면 사용자는 "요청이 안 나갔다"로
 * 읽는다 — 실제로는 우리가 못 본 것이다.
 *
 * `buffered: true`가 핵심이다: 관찰을 시작하기 **전에** 쌓인 엔트리까지 받아 온다.
 * 그래서 init 이전 요청이 복구된다.
 *
 * 중복은 시각으로 가른다. 훅 설치 이후의 fetch/xhr은 훅이 더 정확하게(메서드·상태
 * 코드·본문) 보고하므로 여기서는 건너뛴다. 그 이전 것은 훅이 볼 수 없었으므로 보고한다.
 */
function hookResourceTiming({ sessionId, emit }: HookOptions): () => void {
  if (typeof PerformanceObserver !== 'function' || typeof performance === 'undefined') {
    return () => undefined;
  }
  // performance.now() 기준 — 엔트리의 startTime과 같은 시간축이어야 비교가 성립한다
  const installedAt = performance.now();

  const report = (entries: PerformanceEntryList): void => {
    for (const entry of entries) {
      const resource = entry as PerformanceResourceTiming;
      const kind = initiatorKind(resource.initiatorType);
      // 훅이 이미 보고했을 요청은 건너뛴다 (훅 쪽이 상태 코드·메서드까지 안다)
      if ((kind === 'fetch' || kind === 'xhr') && resource.startTime >= installedAt) continue;
      // 우리 자신의 허브 통신은 보고하지 않는다 — 관찰이 관찰을 낳는다
      if (resource.name.includes('/agent')) continue;
      const status = resource.responseStatus;
      emit({
        type: 'network',
        sessionId,
        // 리소스 타이밍은 메서드를 주지 않는다. 브라우저가 이 방식으로 세는 것은
        // 사실상 전부 GET이지만, 단정하지 않고 모른다고 말한다
        method: kind === 'beacon' ? 'POST' : 'GET',
        url: resource.name,
        // 0은 "실패"로 읽히므로 모를 때는 아예 비운다 (프로토콜 주석 참조)
        ...(typeof status === 'number' && status > 0 ? { status } : {}),
        durationMs: Math.round(resource.duration),
        initiator: kind,
        observed: true,
        ts: Date.now() - Math.round(performance.now() - resource.startTime),
      });
    }
  };

  const observer = new PerformanceObserver((list) => report(list.getEntries()));
  try {
    // buffered: 관찰 시작 전에 쌓인 것까지 — init 이전 요청을 되살리는 지점
    observer.observe({ type: 'resource', buffered: true });
  } catch {
    // 이 타입을 모르는 브라우저 — 훅이 보는 것만으로 계속 동작한다
    return () => undefined;
  }
  return () => observer.disconnect();
}

/** `PerformanceResourceTiming.initiatorType`을 화면에 쓸 이름으로 */
function initiatorKind(initiatorType: string): string {
  if (initiatorType === 'xmlhttprequest') return 'xhr';
  if (initiatorType === 'link') return 'css';
  // 'other'는 EventSource·동적 import 등 브라우저가 분류하지 않은 것들이다
  return initiatorType || 'other';
}

/**
 * 사용자가 한 일 — 클릭·입력·키·제출·스크롤.
 *
 * 왜 필요한가: 로그와 요청만으로는 "무엇 때문에"가 빠진다. 웹뷰에는 개발자도구가 없어
 * 재현 절차를 물어볼 수도 없다. 타임라인에 상호작용이 있으면 "결제 버튼을 눌렀더니
 * 이 요청이 실패했다"가 한 화면에서 읽힌다.
 *
 * **입력 값은 절대 담지 않는다** — 비밀번호·카드번호가 로그로 새는 것은 이 툴이 만들면
 * 안 되는 사고다. 길이만 담는다. `capture: true`로 캡처 단계에서 듣기 때문에 페이지가
 * `stopPropagation()`을 해도 놓치지 않고, **passive라 페이지 동작에 영향을 주지 않는다.**
 */
function hookInteractions({ sessionId, emit, maxTextLength }: HookOptions): () => void {
  if (typeof document === 'undefined') return () => undefined;

  const send = (kind: string, event: Event, extra: Record<string, unknown> = {}): void => {
    emit({
      type: 'interaction',
      sessionId,
      kind,
      target: describeTarget(event.target, maxTextLength),
      ...extra,
      ts: Date.now(),
    });
  };

  const onClick = (event: Event) => send('click', event);
  const onSubmit = (event: Event) => send('submit', event);
  const onKeydown = (event: Event) => {
    const key = (event as KeyboardEvent).key;
    // 문자 키는 담지 않는다 — 이어 붙이면 타이핑한 내용이 그대로 복원된다.
    // 흐름을 읽는 데 필요한 것은 Enter·Escape·Tab 같은 조작 키다
    if (key === undefined || key.length === 1) return;
    send('keydown', event, { key });
  };
  const onInput = (event: Event) => {
    const target = event.target as { value?: unknown } | null;
    const value = typeof target?.value === 'string' ? target.value : undefined;
    send('input', event, value === undefined ? {} : { valueLength: value.length });
  };

  document.addEventListener('click', onClick, { capture: true, passive: true });
  document.addEventListener('submit', onSubmit, { capture: true, passive: true });
  document.addEventListener('keydown', onKeydown, { capture: true, passive: true });
  document.addEventListener('input', onInput, { capture: true, passive: true });
  return () => {
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('submit', onSubmit, true);
    document.removeEventListener('keydown', onKeydown, true);
    document.removeEventListener('input', onInput, true);
  };
}

/** 요소를 사람이 알아볼 수 있게 — 태그 + id/클래스 + 보이는 텍스트 */
function describeTarget(target: EventTarget | null, maxTextLength: number): string {
  const element = target as Element | null;
  if (element?.tagName === undefined) return 'document';
  let described = element.tagName.toLowerCase();
  if (element.id) described += `#${element.id}`;
  const className = typeof element.className === 'string' ? element.className.trim() : '';
  if (className) described += `.${className.split(/\s+/).slice(0, 2).join('.')}`;
  // 보이는 텍스트가 있으면 그게 사람에게 가장 확실한 단서다 ("결제하기")
  const text = element.textContent?.trim().replace(/\s+/g, ' ');
  if (text) described += ` "${truncate(text, Math.min(maxTextLength, 40))}"`;
  return described;
}

/**
 * 렌더링·응답성 지표 — 웹뷰에서 "왜 이렇게 느리지"에 손댈 수 있게 한다.
 *
 * 전부 `PerformanceObserver`라 페이지에 아무것도 주입하지 않는다. 지원하지 않는 타입은
 * 조용히 건너뛴다 — 브라우저마다 가진 것이 다르고, 하나가 없다고 나머지를 포기할 이유가 없다.
 */
function hookVitals({ sessionId, emit }: HookOptions): () => void {
  if (typeof PerformanceObserver !== 'function') return () => undefined;
  const observers: PerformanceObserver[] = [];

  const observe = (type: string, handle: (entry: PerformanceEntry) => void): void => {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) handle(entry);
      });
      observer.observe({ type, buffered: true });
      observers.push(observer);
    } catch {
      // 이 브라우저가 모르는 지표 — 나머지는 그대로 동작한다
    }
  };

  /**
   * 페이지당 한 번뿐인 지표는 한 번만 낸다.
   *
   * 실측: `buffered: true`로 관찰을 시작하면 브라우저가 같은 navigation 엔트리를 두 번
   * 전달하는 경우가 있어 타임라인에 `TTFB 8ms`가 두 줄로 찍혔다. 같은 사건이 두 번
   * 일어난 것처럼 읽히므로 지표를 믿을 수 없게 만든다. LCP·CLS·INP·longtask는 갱신되거나
   * 여러 번 발생하는 것이 정상이라 여기 넣지 않는다.
   */
  const once = new Set<string>();
  const ONCE_PER_PAGE = ['TTFB', 'FCP'];

  const report = (name: string, value: number, detail?: string): void => {
    if (ONCE_PER_PAGE.includes(name)) {
      if (once.has(name)) return;
      once.add(name);
    }
    emit({
      type: 'vital',
      sessionId,
      name,
      value: Math.round(value * 100) / 100,
      ...(detail === undefined ? {} : { detail }),
      ts: Date.now(),
    });
  };

  observe('largest-contentful-paint', (entry) => {
    const element = (entry as unknown as { element?: Element }).element;
    report('LCP', entry.startTime, element?.tagName?.toLowerCase());
  });
  observe('paint', (entry) => {
    if (entry.name === 'first-contentful-paint') report('FCP', entry.startTime);
  });
  observe('layout-shift', (entry) => {
    const shift = entry as unknown as { value: number; hadRecentInput: boolean };
    // 사용자 입력 직후의 이동은 의도된 것이다 — CLS 정의가 그렇다
    if (shift.hadRecentInput || shift.value < 0.01) return;
    report('CLS', shift.value);
  });
  observe('event', (entry) => {
    const timing = entry as unknown as { duration: number; name: string };
    // 느린 상호작용만 — 전부 보내면 회선과 링버퍼를 상호작용이 잠식한다
    if (timing.duration < 200) return;
    report('INP', timing.duration, timing.name);
  });
  observe('longtask', (entry) => {
    report('longtask', entry.duration);
  });
  observe('navigation', (entry) => {
    const nav = entry as PerformanceNavigationTiming;
    report('TTFB', nav.responseStart);
  });

  return () => {
    for (const observer of observers) observer.disconnect();
  };
}
