import { CAPTURE_FILE_VERSION } from '@crosspane/protocol';
import { MAX_SCREEN_EVENTS } from './constants';
import {
  logEntryFromEvent,
  mergeRepeatedLog,
  networkEntryFromEvent,
  screenEventFromEvent,
} from './event-log';
import { trimScreenEvents } from './screen-events';
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
  if (
    capture.version !== CAPTURE_FILE_VERSION ||
    !capture.session?.id ||
    !Array.isArray(capture.events)
  ) {
    throw new CaptureParseError(
      `Not a crosspane capture file (expected version ${CAPTURE_FILE_VERSION})`,
    );
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
    if (!logEntry) continue;
    // 라이브와 같은 규칙으로 연속 중복을 합친다 — 구버전 에이전트가 만든 파일은
    // 같은 에러 수천 줄로 채워져 있을 수 있다
    const merged = mergeRepeatedLog(logs[logs.length - 1], logEntry);
    if (merged) logs[logs.length - 1] = merged;
    else logs.push({ ...logEntry, id: id++ });
  }
  return {
    session: capture.session,
    logs,
    networkEntries,
    // 화면 이벤트는 상한을 적용한다 — 반드시 재생 체크포인트에서만 자른다
    screenEvents: trimScreenEvents(screenEvents, MAX_SCREEN_EVENTS),
  };
}
