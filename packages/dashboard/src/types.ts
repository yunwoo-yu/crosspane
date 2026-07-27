export type EngineName = 'chromium' | 'webkit' | 'firefox';

export type EngineStatus = 'starting' | 'ready' | 'error';

/** 바이너리 프레임 패킷의 1바이트 엔진 식별자 → 엔진 이름 (cli protocol.ts와 동기화) */
export const ENGINE_NAMES_BY_CODE: readonly EngineName[] = ['chromium', 'webkit', 'firefox'];

export interface HelloEvent {
  type: 'hello';
  url: string;
  device: string;
  engines: EngineName[];
  viewport: { width: number; height: number };
}

/** 서버 → 대시보드 JSON 이벤트 (프레임 제외 — 프레임은 바이너리 패킷) */
export type ServerEvent =
  | HelloEvent
  | { type: 'console'; engine: EngineName; level: string; text: string; ts: number }
  | { type: 'pageerror'; engine: EngineName; message: string; ts: number }
  | { type: 'requestfailed'; engine: EngineName; url: string; error: string; ts: number }
  | { type: 'engine-status'; engine: EngineName; status: EngineStatus; detail?: string };

/** 대시보드 → 서버 입력 커맨드. 모든 엔진에 미러링된다 */
export type ClientCommand =
  | { type: 'click'; x: number; y: number }
  | { type: 'scroll'; deltaY: number }
  | { type: 'keypress'; key: string }
  | { type: 'reload' }
  | { type: 'navigate'; url: string };

export interface EngineState {
  status: EngineStatus;
  detail?: string;
}

export interface LogEntry {
  id: number;
  engine: EngineName;
  kind: 'console' | 'pageerror' | 'requestfailed';
  level: string;
  text: string;
  ts: number;
}

export type FrameListener = (frame: ImageBitmap) => void;
