// 프로토콜은 cli의 단일 소스(packages/cli/src/protocol.ts)를 직접 참조한다.
// (vite alias + tsconfig paths — .claude/rules/protocol-sync.md 참조)

export type {
  ClientCommand,
  EngineName,
  EngineStatus,
  HelloEvent,
  ServerEvent,
} from 'crosspane/protocol';
export {
  ENGINE_NAMES_BY_CODE,
  FRAME_FLAG_FULL_PAGE,
  FRAME_HEADER_BYTES,
  PACKET_TYPE_FRAME,
  PACKET_TYPE_VIDEO,
  SCROLL_Y_UNKNOWN,
  VIDEO_HEADER_BYTES,
} from 'crosspane/protocol';

import type { EngineName, EngineStatus } from 'crosspane/protocol';

// ---- 이하 대시보드 전용 UI 타입 ----

export interface EngineState {
  status: EngineStatus;
  detail?: string;
  /** 세션 기동 후 확정된 입력 가능 여부 (hello의 정적 목록을 덮어씀) */
  viewOnly?: boolean;
  /** 마지막 내비게이션 기준 현재 URL — 엔진 간 어긋남(desync) 감지에 쓴다 */
  currentUrl?: string;
}

export interface LogEntry {
  id: number;
  engine: EngineName;
  kind: 'console' | 'pageerror' | 'requestfailed' | 'httperror' | 'navigation';
  level: string;
  text: string;
  ts: number;
}

export interface NetworkEntry {
  id: number;
  engine: EngineName;
  method: string;
  url: string;
  status: number;
  resourceType: string;
  durationMs: number;
  responseHeaders?: Record<string, string>;
  bodyPreview?: string;
  bodyTruncated?: boolean;
  ts: number;
}

/** scrollY: 프레임 캡처 시점의 스크롤 위치(CSS px), 모르면 음수 */
export type FrameListener = (frame: ImageBitmap, scrollY: number, fullPage?: boolean) => void;
