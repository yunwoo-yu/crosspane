import type { LogEntry, NetworkEntry, ServerEvent, SessionMeta, SessionState } from './types';

export type SessionStates = Record<string, SessionState>;
export type SessionMetas = Record<string, SessionMeta>;

/**
 * 서버 이벤트 → 세션 상태 전이 (순수 함수).
 *
 * 불변식: navigation은 errorCount를 0으로 리셋한다 — 이전 페이지의 에러가
 * 현재 화면의 상태처럼 보이면 안 된다.
 */
export function reduceSessionStates(prev: SessionStates, event: ServerEvent): SessionStates {
  switch (event.type) {
    case 'hello':
      return Object.fromEntries(
        event.sessions.map((session) => [session.id, { live: true, errorCount: 0 }]),
      );
    case 'session-joined':
      return {
        ...prev,
        [event.session.id]: { ...prev[event.session.id], live: true, errorCount: 0 },
      };
    case 'session-left':
      return prev[event.sessionId]
        ? { ...prev, [event.sessionId]: { ...prev[event.sessionId], live: false } }
        : prev;
    case 'navigation':
      return {
        ...prev,
        [event.sessionId]: {
          live: prev[event.sessionId]?.live ?? true,
          currentUrl: event.url,
          errorCount: 0,
        },
      };
    case 'pageerror':
      return {
        ...prev,
        [event.sessionId]: {
          live: prev[event.sessionId]?.live ?? true,
          currentUrl: prev[event.sessionId]?.currentUrl,
          errorCount: (prev[event.sessionId]?.errorCount ?? 0) + 1,
        },
      };
    default:
      return prev;
  }
}

/** 세션 메타 누적 — hello(전체 목록)와 session-joined(증분)를 같은 맵으로 */
export function reduceSessionMetas(prev: SessionMetas, event: ServerEvent): SessionMetas {
  switch (event.type) {
    case 'hello':
      return Object.fromEntries(event.sessions.map((session) => [session.id, session]));
    case 'session-joined':
      return { ...prev, [event.session.id]: event.session };
    default:
      return prev;
  }
}

/** 콘솔 타임라인에 실릴 이벤트 → 로그 엔트리 매핑 (순수 함수). 해당 없으면 null */
export function logEntryFromEvent(event: ServerEvent): Omit<LogEntry, 'id'> | null {
  switch (event.type) {
    case 'console':
      return {
        sessionId: event.sessionId,
        kind: 'console',
        level: event.level,
        text: event.text,
        ts: event.ts,
      };
    case 'pageerror':
      return {
        sessionId: event.sessionId,
        kind: 'pageerror',
        level: 'error',
        text: event.message,
        detail: event.stack,
        ts: event.ts,
      };
    case 'navigation':
      // 콘솔 타임라인의 구분선 — 페이지 이동 피드백 겸 로그 구간 구분
      return {
        sessionId: event.sessionId,
        kind: 'navigation',
        level: 'info',
        text: event.url,
        ts: event.ts,
      };
    default:
      return null;
  }
}

/** 네트워크 패널 엔트리 매핑 (순수 함수). 해당 없으면 null */
export function networkEntryFromEvent(event: ServerEvent): Omit<NetworkEntry, 'id'> | null {
  if (event.type !== 'network') return null;
  return {
    sessionId: event.sessionId,
    method: event.method,
    url: event.url,
    status: event.status,
    durationMs: event.durationMs,
    error: event.error,
    initiator: event.initiator,
    responseHeaders: event.responseHeaders,
    bodyPreview: event.bodyPreview,
    bodyTruncated: event.bodyTruncated,
    ts: event.ts,
  };
}
