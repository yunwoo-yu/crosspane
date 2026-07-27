export type EngineName = 'chromium' | 'webkit' | 'firefox';

export type LogLevel = 'log' | 'info' | 'warning' | 'error' | 'debug' | string;

export type EngineStatus = 'starting' | 'ready' | 'error';

/**
 * 프레임은 JSON이 아니라 [엔진코드 1바이트][JPEG 원본] 바이너리 패킷으로 전송한다.
 * base64(+33% 크기)와 JSON 파싱 비용을 제거하기 위함이다.
 */
export const ENGINE_CODES: Record<EngineName, number> = {
  chromium: 0,
  webkit: 1,
  firefox: 2,
};

export const ENGINE_NAMES_BY_CODE: readonly EngineName[] = ['chromium', 'webkit', 'firefox'];

export function encodeFramePacket(engine: EngineName, jpeg: Buffer): Buffer {
  return Buffer.concat([Buffer.from([ENGINE_CODES[engine]]), jpeg]);
}

export interface HelloEvent {
  type: 'hello';
  url: string;
  device: string;
  engines: EngineName[];
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
