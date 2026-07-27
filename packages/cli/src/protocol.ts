export type EngineName = 'chromium' | 'webkit' | 'firefox' | 'ios-sim' | 'android';

/** Playwright로 구동되는 브라우저 엔진 (ios-sim/android는 실기기 어댑터가 담당) */
export type BrowserEngineName = Exclude<EngineName, 'ios-sim' | 'android'>;

export type LogLevel = 'log' | 'info' | 'warning' | 'error' | 'debug' | string;

export type EngineStatus = 'starting' | 'ready' | 'error';

/**
 * 프레임 바이너리 패킷: [엔진코드 u8][scrollY int32LE, 모르면 -1][JPEG 원본].
 * - base64(+33% 크기)와 JSON 파싱 비용을 제거
 * - scrollY는 대시보드의 로컬 에코(스크롤 예측)를 실제 위치로 보정하는 데 쓴다
 */
export const ENGINE_CODES: Record<EngineName, number> = {
  chromium: 0,
  webkit: 1,
  firefox: 2,
  'ios-sim': 3,
  android: 4,
};

export const ENGINE_NAMES_BY_CODE: readonly EngineName[] = [
  'chromium',
  'webkit',
  'firefox',
  'ios-sim',
  'android',
];

export const FRAME_HEADER_BYTES = 5;
export const SCROLL_Y_UNKNOWN = -1;

export function encodeFramePacket(engine: EngineName, jpeg: Buffer, scrollY: number): Buffer {
  const header = Buffer.alloc(FRAME_HEADER_BYTES);
  header.writeUInt8(ENGINE_CODES[engine], 0);
  header.writeInt32LE(Math.round(scrollY), 1);
  return Buffer.concat([header, jpeg]);
}

export interface HelloEvent {
  type: 'hello';
  url: string;
  device: string;
  engines: EngineName[];
  /** 입력 미러링이 불가능한 보기 전용 엔진 (예: iOS 시뮬레이터) */
  viewOnlyEngines?: EngineName[];
  viewport: { width: number; height: number };
}

/** 서버 → 대시보드로 흐르는 JSON 이벤트 (프레임 제외 — 프레임은 바이너리) */
export type ServerEvent =
  | HelloEvent
  | { type: 'console'; engine: EngineName; level: LogLevel; text: string; ts: number }
  | { type: 'pageerror'; engine: EngineName; message: string; ts: number }
  | { type: 'requestfailed'; engine: EngineName; url: string; error: string; ts: number }
  | { type: 'engine-status'; engine: EngineName; status: EngineStatus; detail?: string }
  | { type: 'navigation'; engine: EngineName; url: string; ts: number }
  | { type: 'httperror'; engine: EngineName; url: string; status: number; ts: number };

/** 대시보드 → 서버로 흐르는 입력 커맨드. 모든 엔진에 미러링된다 */
export type ClientCommand =
  | { type: 'click'; x: number; y: number }
  | { type: 'scroll'; deltaY: number }
  | { type: 'keypress'; key: string }
  | { type: 'type'; text: string }
  | { type: 'back' }
  | { type: 'forward' }
  | { type: 'reload' }
  | { type: 'navigate'; url: string };
