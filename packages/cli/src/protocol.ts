export type EngineName = 'chromium' | 'webkit' | 'firefox';

export type LogLevel = 'log' | 'info' | 'warning' | 'error' | 'debug' | string;

export type EngineStatus = 'starting' | 'ready' | 'error';

export interface HelloMessage {
  type: 'hello';
  url: string;
  device: string;
  engines: EngineName[];
  viewport: { width: number; height: number };
}

export type ServerMessage =
  | HelloMessage
  | { type: 'frame'; engine: EngineName; data: string }
  | { type: 'console'; engine: EngineName; level: LogLevel; text: string; ts: number }
  | { type: 'pageerror'; engine: EngineName; message: string; ts: number }
  | { type: 'requestfailed'; engine: EngineName; url: string; error: string; ts: number }
  | { type: 'engine-status'; engine: EngineName; status: EngineStatus; detail?: string };

export type ClientMessage =
  | { type: 'click'; x: number; y: number }
  | { type: 'scroll'; deltaY: number }
  | { type: 'keypress'; key: string }
  | { type: 'reload' }
  | { type: 'navigate'; url: string };
