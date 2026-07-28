import type { EngineName, EngineState, LogEntry, ServerEvent } from './types';

export type EngineStates = Partial<Record<EngineName, EngineState>>;

/**
 * 서버 이벤트 → engineStates 전이 (순수 함수).
 *
 * 불변식: engine-status/navigation은 기존 필드(viewOnly/detail)를 스프레드로
 * 보존해야 한다 — 새 객체로 교체하면 셸 모드가 해제한 view-only가
 * 내비게이션마다 되살아난다 (실측 버그, frame-rendering.md).
 */
export function reduceEngineStates(prev: EngineStates, event: ServerEvent): EngineStates {
  switch (event.type) {
    case 'hello':
      return Object.fromEntries(event.engines.map((engine) => [engine, { status: 'starting' }]));
    case 'engine-status':
      return {
        ...prev,
        [event.engine]: {
          ...prev[event.engine],
          status: event.status,
          detail: event.detail,
          viewOnly: event.viewOnly ?? prev[event.engine]?.viewOnly,
        },
      };
    case 'navigation':
      return {
        ...prev,
        [event.engine]: {
          ...prev[event.engine],
          status: prev[event.engine]?.status ?? 'ready',
          currentUrl: event.url,
        },
      };
    default:
      return prev;
  }
}

/** 콘솔 타임라인에 실릴 이벤트 → 로그 엔트리 매핑 (순수 함수). 해당 없으면 null */
export function logEntryFromEvent(event: ServerEvent): Omit<LogEntry, 'id'> | null {
  switch (event.type) {
    case 'console':
      return {
        engine: event.engine,
        kind: 'console',
        level: event.level,
        text: event.text,
        ts: event.ts,
      };
    case 'pageerror':
      return {
        engine: event.engine,
        kind: 'pageerror',
        level: 'error',
        text: event.message,
        ts: event.ts,
      };
    case 'requestfailed':
      return {
        engine: event.engine,
        kind: 'requestfailed',
        level: 'error',
        text: `${event.url} — ${event.error}`,
        ts: event.ts,
      };
    case 'httperror':
      return {
        engine: event.engine,
        kind: 'httperror',
        level: 'error',
        text: `HTTP ${event.status} — ${event.url}`,
        ts: event.ts,
      };
    case 'navigation':
      // 콘솔 타임라인의 구분선 — 리로드/이동 피드백 겸 로그 구간 구분
      return {
        engine: event.engine,
        kind: 'navigation',
        level: 'info',
        text: event.url,
        ts: event.ts,
      };
    default:
      return null;
  }
}
