export const MAX_LOGS = 500;
// 네트워크 항목은 양이 많다 — 이 이상은 오래된 것부터 버린다
export const MAX_NETWORK_ENTRIES = 800;

/**
 * 세션별 화면(rrweb) 이벤트 상한. 초당 수십 건이 들어올 수 있어 상한이 필요하지만,
 * 자를 때는 반드시 재생 체크포인트에서만 자른다 (screen-events.ts 참조).
 */
export const MAX_SCREEN_EVENTS = 5_000;

export const RECONNECT_DELAY_MS = 1_000;

// 콘솔/네트워크 이벤트는 폭주할 수 있다(폴링 앱, 루프 로그) — 이벤트당 setState 대신
// 이 간격으로 배칭해 리렌더를 초당 ~20회로 상한한다
export const EVENT_BATCH_MS = 50;

/** 세션 platform → 표시 라벨 */
export const PLATFORM_LABEL: Record<string, string> = {
  'android-webview': 'Android WebView',
  'ios-webview': 'iOS WebView',
  'in-app-browser': 'In-app browser',
  browser: 'Browser',
};
