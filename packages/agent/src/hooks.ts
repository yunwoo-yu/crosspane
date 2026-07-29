import type { SessionEvent } from '@crosspane/protocol';

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
  return teardowns;
}

/** 상한을 넘으면 잘라내고 잘렸음을 알린다 — 조용히 버리면 디버깅을 오도한다 */
function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}… (truncated, ${text.length} chars)`;
}

/**
 * 예산 안에서만 직렬화한다.
 *
 * `JSON.stringify(arg)`를 먼저 다 만든 뒤 자르면, 거대한 객체를 로그하는 페이지가
 * 버려질 문자열을 전부 만드는 비용을 문다 — 계측이 페이지를 느리게 만들면 안 된다.
 * replacer가 누적 크기를 세다가 예산을 넘기면 이후 값을 생략해, 결과는 잘린 JSON이
 * 되고 거대한 문자열이 애초에 만들어지지 않는다.
 *
 * 잘림 여부를 함께 돌려주는 이유: 조용히 버리면 디버깅을 오도한다.
 */
function serializeArg(arg: unknown, budget: number): { text: string; truncated: boolean } {
  if (typeof arg === 'string') {
    return arg.length <= budget
      ? { text: arg, truncated: false }
      : { text: arg.slice(0, budget), truncated: true };
  }
  if (arg instanceof Error) {
    const stack = arg.stack ?? arg.message;
    return stack.length <= budget
      ? { text: stack, truncated: false }
      : { text: stack.slice(0, budget), truncated: true };
  }

  let used = 0;
  try {
    const json = JSON.stringify(arg, (_key, value) => {
      if (used > budget) return undefined; // 예산 초과 — 이후 값은 싣지 않는다
      used += typeof value === 'string' ? value.length + 2 : 8; // 구분자 포함 근사
      return value;
    });
    return { text: json ?? String(arg), truncated: used > budget };
  } catch {
    return { text: String(arg), truncated: false }; // 순환 참조, toJSON 예외 등
  }
}

/** 콘솔 인자들을 하나의 텍스트로 — 잘렸으면 끝에 한 번만 알린다 */
function serializeArgs(args: unknown[], budget: number): string {
  let truncated = false;
  const parts = args.map((arg) => {
    const result = serializeArg(arg, budget);
    truncated = truncated || result.truncated;
    return result.text;
  });
  let text = parts.join(' ');
  if (text.length > budget) {
    text = text.slice(0, budget);
    truncated = true;
  }
  return truncated ? `${text}… (truncated)` : text;
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
