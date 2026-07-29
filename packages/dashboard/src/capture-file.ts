import { logEntryFromEvent, networkEntryFromEvent, screenEventFromEvent } from './event-log';
import type { LogEntry, NetworkEntry, SessionCapture, SessionMeta } from './types';

export interface LoadedCapture {
  session: SessionMeta;
  logs: LogEntry[];
  networkEntries: NetworkEntry[];
  /** rrweb 이벤트 원본 — 화면 기록이 있는 캡처만 채워진다 */
  screenEvents: unknown[];
}

export class CaptureParseError extends Error {}

/**
 * .crosspane.json 파싱 — 에이전트가 export한 파일을 라이브와 같은 엔트리 모양으로.
 * 라이브/리플레이가 같은 패널 코드를 쓰도록 여기서만 변환한다.
 */
export function parseCaptureFile(text: string): LoadedCapture {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CaptureParseError('Not a valid JSON file');
  }
  const capture = parsed as Partial<SessionCapture>;
  if (capture.version !== 1 || !capture.session?.id || !Array.isArray(capture.events)) {
    throw new CaptureParseError('Not a crosspane capture file (expected version 1)');
  }

  const logs: LogEntry[] = [];
  const networkEntries: NetworkEntry[] = [];
  const screenEvents: unknown[] = [];
  let id = 0;
  for (const event of capture.events) {
    const screen = screenEventFromEvent(event);
    if (screen) {
      screenEvents.push(screen.data);
      continue;
    }
    const networkEntry = networkEntryFromEvent(event);
    if (networkEntry) {
      networkEntries.push({ ...networkEntry, id: id++ });
      continue;
    }
    const logEntry = logEntryFromEvent(event);
    if (logEntry) logs.push({ ...logEntry, id: id++ });
  }
  return { session: capture.session, logs, networkEntries, screenEvents };
}
