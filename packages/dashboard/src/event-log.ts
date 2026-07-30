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
        repeat: event.repeat,
        repeatUntil: event.repeatUntil,
        ts: event.ts,
      };
    case 'pageerror':
      return {
        sessionId: event.sessionId,
        kind: 'pageerror',
        level: 'error',
        text: event.message,
        detail: event.stack,
        repeat: event.repeat,
        repeatUntil: event.repeatUntil,
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

/** 화면 재생용 rrweb 이벤트 추출 — screen 이벤트의 data를 그대로 돌려준다 */
export function screenEventFromEvent(
  event: ServerEvent,
): { sessionId: string; data: unknown } | null {
  if (event.type !== 'screen') return null;
  return { sessionId: event.sessionId, data: event.data };
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
    observed: event.observed,
    responseHeaders: event.responseHeaders,
    bodyPreview: event.bodyPreview,
    bodyTruncated: event.bodyTruncated,
    ts: event.ts,
  };
}

/**
 * 연속 중복 로그를 앞 엔트리에 합친다 (합쳤으면 새 엔트리, 아니면 null).
 *
 * 에이전트가 이미 합쳐 보내지만 여기서도 한다: 전송 배치 경계에서 런이 갈리고,
 * 구버전 에이전트는 합치지 않는다. 표시 상한(MAX_LOGS)이 **서로 다른** 엔트리를
 * 담아야 원인 로그가 스팸에 밀려나지 않는다.
 */
export function mergeRepeatedLog(
  last: LogEntry | undefined,
  next: Omit<LogEntry, 'id'>,
): LogEntry | null {
  if (!last || last.kind !== next.kind || last.sessionId !== next.sessionId) return null;
  // 내비게이션 구분선은 합치지 않는다 — 같은 URL로 두 번 이동한 것은 다른 사실이다
  if (last.kind === 'navigation') return null;
  if (last.text !== next.text || last.level !== next.level || last.detail !== next.detail) {
    return null;
  }
  // ts는 첫 발생 시각을, repeatUntil은 마지막 발생 시각을 유지한다 (에이전트와 같은 규칙)
  return {
    ...last,
    repeat: (last.repeat ?? 1) + (next.repeat ?? 1),
    repeatUntil: next.repeatUntil ?? next.ts,
  };
}
