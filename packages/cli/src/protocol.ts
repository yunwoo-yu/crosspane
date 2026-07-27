export type EngineName = 'chromium' | 'webkit' | 'firefox' | 'ios-sim' | 'android';

/** Playwright로 구동되는 브라우저 엔진 (ios-sim/android는 실기기 어댑터가 담당) */
export type BrowserEngineName = Exclude<EngineName, 'ios-sim' | 'android'>;

export type LogLevel = 'log' | 'info' | 'warning' | 'error' | 'debug' | string;

/** stopped = 사용 가능하지만 꺼져 있음 (대시보드에서 시작 가능) */
export type EngineStatus = 'starting' | 'ready' | 'error' | 'stopped';

/**
 * 프레임 바이너리 패킷: [엔진코드 u8][scrollY int32LE, 모르면 -1][JPEG 원본].
 * - base64(+33% 크기)와 JSON 파싱 비용을 제거
 * - scrollY는 대시보드의 로컬 에코(스크롤 예측)를 실제 위치로 보정하는 데 쓴다
 *
 * ⚠ 이 파일은 대시보드(브라우저)가 직접 import하는 단일 소스다 —
 * Node 전용 API(Buffer 등)를 추가하지 말 것 (인코더는 frame-packet.ts)
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

// 바이너리 패킷 규약: 첫 바이트 = 패킷 타입
// FRAME: [type u8][engine u8][flags u8][scrollY i32LE][JPEG] — 스냅샷 프레임
//   flags bit0(FULL_PAGE): JPEG가 뷰포트가 아니라 페이지 전체 — 대시보드가
//   로컬에서 잘라 그려 스크롤을 60fps로 팬한다 (WebKit/Firefox 경로)
// VIDEO: [type u8][engine u8][H.264 Annex-B bytes] — 실시간 비디오 스트림 조각
export const PACKET_TYPE_FRAME = 1;
export const PACKET_TYPE_VIDEO = 2;
export const FRAME_FLAG_FULL_PAGE = 1;
export const FRAME_HEADER_BYTES = 7;
export const VIDEO_HEADER_BYTES = 2;
export const SCROLL_Y_UNKNOWN = -1;

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
  | {
      type: 'engine-status';
      engine: EngineName;
      status: EngineStatus;
      detail?: string;
      /** 세션이 기동하며 입력 가능 여부가 확정되면 갱신 (셸 성공 시 ios-sim이 인터랙티브로) */
      viewOnly?: boolean;
    }
  | { type: 'navigation'; engine: EngineName; url: string; ts: number }
  | { type: 'httperror'; engine: EngineName; url: string; status: number; ts: number }
  | {
      /** 네트워크 패널용 전체 응답 수집 — 엔진 간 같은 요청의 상태/속도 비교가 목적 */
      type: 'network';
      engine: EngineName;
      method: string;
      url: string;
      status: number;
      resourceType: string;
      durationMs: number;
      /** xhr/fetch에 한해 수집 — 상세 뷰용 (바디는 텍스트/JSON만, 상한 잘림) */
      responseHeaders?: Record<string, string>;
      bodyPreview?: string;
      bodyTruncated?: boolean;
      ts: number;
    };

/** 대시보드 → 서버 커맨드. 입력 계열은 모든 엔진에 미러링, engine 제어는 서버가 처리 */
export type ClientCommand =
  | { type: 'start-engine'; engine: EngineName }
  | { type: 'stop-engine'; engine: EngineName }
  /** 이 클라이언트가 현재 화면에 그리는 엔진 목록 — 서버가 pane별로 캡처를 끈다 */
  | { type: 'watch'; engines: EngineName[] }
  | { type: 'click'; x: number; y: number }
  /** 드래그/스와이프 — 좌표는 0~1 정규화, durationMs는 제스처 소요 시간 */
  | { type: 'drag'; fromX: number; fromY: number; toX: number; toY: number; durationMs: number }
  | { type: 'scroll'; deltaY: number }
  | { type: 'keypress'; key: string }
  | { type: 'type'; text: string }
  | { type: 'back' }
  | { type: 'forward' }
  | { type: 'reload' }
  | { type: 'navigate'; url: string };
