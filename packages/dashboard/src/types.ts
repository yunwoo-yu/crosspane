// 프로토콜 단일 소스는 @crosspane/protocol이다 (vite alias + tsconfig paths)

export type {
  LogLevel,
  ServerEvent,
  SessionCapture,
  SessionEvent,
  SessionMeta,
} from '@crosspane/protocol';

// ---- 이하 대시보드 전용 UI 타입 ----

/** 세션의 화면 표시 상태 — 프로토콜에는 없는 UI 파생값 */
export interface SessionState {
  live: boolean;
  currentUrl?: string;
  /** 마지막 내비게이션 이후의 에러 수 — 배지용 */
  errorCount: number;
}

export interface LogEntry {
  id: number;
  sessionId: string;
  kind: 'console' | 'pageerror' | 'navigation';
  level: string;
  text: string;
  /** pageerror의 스택 — 상세 펼침용 */
  detail?: string;
  /** 연속 반복 횟수 (없으면 1). 스팸이 표시 상한을 잠식하는 것을 막는다 */
  repeat?: number;
  /** 마지막 발생 시각 — 반복이 언제까지 이어졌는지 (ts는 첫 발생) */
  repeatUntil?: number;
  ts: number;
}

export interface NetworkEntry {
  id: number;
  sessionId: string;
  method: string;
  url: string;
  /** 없을 수 있다 — 리소스 타이밍으로 관측된 요청은 상태 코드를 모른다 */
  status?: number;
  durationMs: number;
  error?: string;
  initiator?: string;
  responseHeaders?: Record<string, string>;
  bodyPreview?: string;
  bodyTruncated?: boolean;
  /** 훅이 아니라 리소스 타이밍으로 관측된 요청 (정보가 적은 이유) */
  observed?: boolean;
  ts: number;
}
