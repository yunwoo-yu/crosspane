import type { EngineName } from './types';

export const MAX_LOGS = 500;
// 네트워크 항목은 양이 많다 — 이 이상은 오래된 것부터 버린다
export const MAX_NETWORK_ENTRIES = 800;

// 트랙패드는 초당 수십 개의 wheel 이벤트를 발생시킨다.
// 이 간격 동안 델타를 모아 하나의 scroll 커맨드로 합쳐 백로그를 방지한다.
// (scrollBy는 즉시 실행이라 30/s 수준의 커맨드는 문제없다)
export const WHEEL_COALESCE_MS = 33;

export const RECONNECT_DELAY_MS = 1_000;

// 콘솔/네트워크 이벤트는 폭주할 수 있다(HMR, 폴링 앱) — 이벤트당 setState 대신
// 이 간격으로 배칭해 리렌더를 초당 ~20회로 상한한다
export const EVENT_BATCH_MS = 50;

export const ENGINE_LABEL: Record<EngineName, string> = {
  chromium: 'Chromium · Android WebView',
  webkit: 'WebKit · iOS WKWebView',
  firefox: 'Firefox · Gecko',
  'ios-sim': 'iOS Simulator · Real Device',
  android: 'Android Emulator · Real Device',
};
