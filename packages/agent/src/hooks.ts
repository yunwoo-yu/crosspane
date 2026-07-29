import type { SessionEvent } from '@crosspane/protocol';

export interface HookOptions {
  sessionId: string;
  emit: (event: SessionEvent) => void;
  /** 네트워크 응답 바디 수집 (기본 꺼짐 — 프라이버시 안전 기본값) */
  captureBodies: boolean;
  bodyPreviewLimit: number;
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

function serializeArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.stack ?? arg.message;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

/** 후킹 대상 console 메서드 — LogLevel(=string 포함)로 인덱싱하면 타입이 풀린다 */
const CONSOLE_LEVELS = ['log', 'info', 'warn', 'error', 'debug'] as const;
type ConsoleLevel = (typeof CONSOLE_LEVELS)[number];

function hookConsole({ sessionId, emit }: HookOptions): () => void {
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
        text: args.map(serializeArg).join(' '),
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

function hookErrors({ sessionId, emit }: HookOptions): () => void {
  const onError = (event: ErrorEvent): void => {
    emit({
      type: 'pageerror',
      sessionId,
      message: event.message,
      stack: event.error instanceof Error ? event.error.stack : undefined,
      ts: Date.now(),
    });
  };
  const onRejection = (event: PromiseRejectionEvent): void => {
    const reason = event.reason;
    emit({
      type: 'pageerror',
      sessionId,
      message: `Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`,
      stack: reason instanceof Error ? reason.stack : undefined,
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
  const originalPush = history.pushState.bind(history);
  const originalReplace = history.replaceState.bind(history);
  history.pushState = (...args) => {
    originalPush(...args);
    emitNavigation();
  };
  history.replaceState = (...args) => {
    originalReplace(...args);
    emitNavigation();
  };
  window.addEventListener('popstate', emitNavigation);
  return () => {
    history.pushState = originalPush;
    history.replaceState = originalReplace;
    window.removeEventListener('popstate', emitNavigation);
  };
}
