/**
 * crosspane 와이어 프로토콜 v2 — 단일 소스.
 *
 * 소비자 셋: 에이전트 SDK(@crosspane/agent, 페이지 내), 허브 서버(crosspane CLI),
 * 대시보드(브라우저). 셋 다 직접 import하므로 런타임 코드/Node 전용 API 금지 —
 * 타입과 순수 상수만.
 *
 * 설계 원칙: 이벤트 모양은 에이전트→서버→대시보드→리플레이 파일까지 끝까지
 * 동일하다. 변환 계층이 없어야 오프라인 파일 리플레이가 라이브와 같은 코드로 돈다.
 */

export type LogLevel = 'log' | 'info' | 'warning' | 'error' | 'debug' | string;

/** 디버깅 대상 하나 — 에이전트가 붙은 웹뷰/페이지/인앱브라우저 */
export interface SessionMeta {
  /** 에이전트가 생성 (세션 수명 동안 불변) */
  id: string;
  /** 개발자가 SDK 옵션으로 주는 표시명 (예: "결제 웹뷰", "iOS QA build") */
  label: string;
  userAgent: string;
  /** 접속 시점 URL */
  url?: string;
  /** 자유 문자열 — 'android-webview' | 'ios-webview' | 'browser' 등 SDK가 추정 */
  platform?: string;
  startedAt: number;
}

/**
 * 세션에서 발생하는 이벤트 — 에이전트가 만들고, 서버는 그대로 중계하고,
 * 리플레이 파일에도 그대로 저장된다. sessionId는 항상 포함(파일 단독 해석 가능).
 */
export type SessionEvent =
  | {
      type: 'console';
      sessionId: string;
      level: LogLevel;
      text: string;
      /**
       * 연속으로 같은 내용이 반복된 횟수 (없으면 1).
       *
       * 깨진 웹뷰는 같은 에러를 초당 수천 번 뱉는다 — 합치지 않으면 링버퍼와
       * 히스토리가 그 한 줄로 가득 차 **원인 이벤트가 밀려나 사라진다**(실측).
       * ts는 첫 발생 시각을 유지해 타임라인 위치가 흔들리지 않는다.
       */
      repeat?: number;
      /**
       * 마지막 발생 시각 (repeat가 있을 때만). **없으면 안 된다** —
       * 10분간 5초마다 반복된 에러가 첫 시각 한 줄로만 접히면 "그때 두 번 나고 멈췄다"로
       * 읽힌다. 지금도 계속되고 있다는 사실이 디버깅에서 가장 중요한 단서일 수 있다.
       */
      repeatUntil?: number;
      ts: number;
    }
  | {
      type: 'pageerror';
      sessionId: string;
      message: string;
      stack?: string;
      /** 연속 반복 횟수 — console의 repeat와 같은 의미 */
      repeat?: number;
      /** 마지막 발생 시각 — console의 repeatUntil과 같은 의미 */
      repeatUntil?: number;
      ts: number;
    }
  | {
      type: 'network';
      sessionId: string;
      method: string;
      url: string;
      /** 0 = 응답 못 받음 (네트워크 실패/차단) — error에 사유 */
      status: number;
      durationMs: number;
      error?: string;
      /** fetch/xhr 구분 등 — 에이전트가 아는 만큼만 */
      initiator?: string;
      responseHeaders?: Record<string, string>;
      bodyPreview?: string;
      bodyTruncated?: boolean;
      ts: number;
    }
  | { type: 'navigation'; sessionId: string; url: string; ts: number }
  /**
   * 화면 기록 조각 — 플러그인(@crosspane/agent-replay 등)이 싣는다.
   * 코어는 내용을 해석하지 않고 그대로 중계하며, 대시보드가 format으로 플레이어를
   * 고른다. format을 열어둔 이유: rrweb 외의 방식(canvas 스트림 등)이 같은 슬롯을
   * 쓸 수 있어야 하고, 코어 프로토콜이 특정 라이브러리에 묶이면 안 되기 때문.
   */
  | { type: 'screen'; sessionId: string; format: string; data: unknown; ts: number };

/** 에이전트 → 서버 (WS /agent). 등록 후에는 이벤트를 배열로 배칭해 보낸다 */
export type AgentMessage =
  | { type: 'register'; session: SessionMeta }
  | { type: 'events'; events: SessionEvent[] };

/** 서버 → 대시보드 (WS /ws) */
export type ServerEvent =
  | { type: 'hello'; sessions: SessionMeta[] }
  | { type: 'session-joined'; session: SessionMeta }
  | { type: 'session-left'; sessionId: string; ts: number }
  | SessionEvent;

/**
 * 오프라인 export 파일 (.crosspane.json) — 보안 잠금 환경의 주력 경로.
 * 에이전트 링버퍼를 그대로 직렬화한 것. 대시보드에 드롭하면 리플레이된다.
 */
export interface SessionCapture {
  version: 1;
  session: SessionMeta;
  events: SessionEvent[];
  exportedAt: number;
}

export const CAPTURE_FILE_VERSION = 1 as const;
export const CAPTURE_FILE_EXTENSION = '.crosspane.json';
