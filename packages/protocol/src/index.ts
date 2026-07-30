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
      /**
       * 0 = 응답 못 받음 (네트워크 실패/차단) — error에 사유.
       *
       * **없을 수 있다.** 리소스 타이밍으로 관측한 요청(이미지·CSS·beacon, 그리고
       * 에이전트가 설치되기 전에 나간 요청)은 브라우저가 상태 코드를 주지 않는
       * 경우가 있다. 0으로 채우면 "실패"로 읽히므로 비워 둔다 — 모르는 것과
       * 실패한 것은 다르다.
       */
      status?: number;
      durationMs: number;
      error?: string;
      /**
       * 무엇이 이 요청을 냈는지 — `fetch` `xhr` `img` `css` `script` `beacon` 등.
       *
       * 훅이 잡은 것은 `fetch`/`xhr`이고, 나머지는 리소스 타이밍에서 온다.
       * 대시보드의 "XHR/fetch만" 필터가 이 값으로 갈라진다
       */
      initiator?: string;
      /**
       * 훅이 아니라 리소스 타이밍으로 **관측**된 요청.
       *
       * 구분하는 이유: 이쪽은 상태 코드와 메서드가 없을 수 있고 요청 본문도 모른다.
       * 화면에서 "왜 이 줄만 정보가 적지"의 답이 되어야 한다
       */
      observed?: boolean;
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
  | { type: 'screen'; sessionId: string; format: string; data: unknown; ts: number }
  /**
   * 사용자가 한 일 — 클릭·입력·키·스크롤·제출.
   *
   * 왜 필요한가: 로그와 요청만 있으면 "무엇 때문에" 그렇게 됐는지가 빠진다. 웹뷰에는
   * 개발자도구가 없어서 재현 절차를 물어볼 수도 없다. 상호작용이 타임라인에 있으면
   * "결제 버튼을 눌렀더니 이 요청이 실패했다"가 한 화면에서 읽힌다.
   *
   * **입력 값은 담지 않는다.** 비밀번호·카드번호가 로그로 새는 것은 이 툴이 절대
   * 만들면 안 되는 사고다. 어느 요소에 입력이 있었는지와 길이만 담는다
   */
  | {
      type: 'interaction';
      sessionId: string;
      /** click · input · change · submit · keydown · scroll */
      kind: string;
      /** 대상 요소를 사람이 알아볼 수 있게 (태그 + id/클래스 + 보이는 텍스트) */
      target: string;
      /** keydown일 때 키 이름. 값이 아니라 키다 (`Enter`, `Escape`) */
      key?: string;
      /** input일 때 **값이 아니라 길이** — 무엇을 쳤는지는 담지 않는다 */
      valueLength?: number;
      ts: number;
    }
  /**
   * 렌더링·응답성 지표 — 렌더링 디버깅에 필요한 것.
   *
   * `LCP` `CLS` `INP` `FCP` `TTFB`는 Web Vitals, `longtask`는 메인 스레드를 막은 작업이다.
   * 웹뷰에서 "왜 이렇게 느리지"는 개발자도구 없이는 손도 못 대던 질문이다
   */
  | {
      type: 'vital';
      sessionId: string;
      /** LCP · CLS · INP · FCP · TTFB · longtask */
      name: string;
      value: number;
      /** 지표가 가리키는 요소나 원인 — 있으면 */
      detail?: string;
      ts: number;
    };

/** 에이전트 → 서버 (WS /agent). 등록 후에는 이벤트를 배열로 배칭해 보낸다 */
export type AgentMessage =
  | { type: 'register'; session: SessionMeta }
  | { type: 'events'; events: SessionEvent[] };

/** 서버 → 대시보드 (WS /ws) */
export type ServerEvent =
  | { type: 'hello'; sessions: SessionMeta[] }
  | { type: 'session-joined'; session: SessionMeta }
  | { type: 'session-left'; sessionId: string; ts: number }
  /**
   * 접속 직후의 히스토리 재생이 끝났다는 신호. 세션당 하나가 아니라 접속당 하나다.
   *
   * 왜 필요한가: 허브는 `hello` 뒤에 히스토리를 **여러 프레임으로** 흘려보낸다. 라이브
   * UI는 몇 프레임 늦게 채워져도 무해하지만, `crosspane mcp`처럼 접속 직후 질문에
   * 답해야 하는 소비자는 재생이 끝났는지 알 방법이 없어 **부분 히스토리로 답한다**
   * (CI에서 플레이크로 드러났고, 실제로는 코딩 에이전트가 "에러 없음"이라 답할 수 있다는 뜻).
   * 이 신호가 그 경계다 — 조용히 자른 답을 주지 않기 위한 것이므로 지우지 말 것.
   */
  | { type: 'history-complete' }
  | SessionEvent;

/**
 * 오프라인 export 파일 (.crosspane.json) — 보안 잠금 환경의 주력 경로.
 * 에이전트 링버퍼를 그대로 직렬화한 것. 대시보드에 드롭하면 리플레이된다.
 */
export interface SessionCapture {
  version: 1;
  session: SessionMeta;
  events: SessionEvent[];
  /**
   * 상한 때문에 **버려진** 이벤트 수 (없거나 0이면 전량).
   *
   * 링버퍼·히스토리 상한은 오래된 것부터 버린다. 이걸 싣지 않으면 긴 세션의 캡처가
   * 앞부분이 잘린 채 완전한 것처럼 보인다 — 이 프로젝트는 다른 모든 상한에서
   * 잘렸음을 밝히므로(텍스트 `(truncated)`, 중복 `×N`, 렌더 `N older hidden`)
   * 가장 중요한 이 경로만 조용한 것은 모순이었다.
   */
  droppedEvents?: number;
  exportedAt: number;
}

export const CAPTURE_FILE_VERSION = 1 as const;
export const CAPTURE_FILE_EXTENSION = '.crosspane.json';
