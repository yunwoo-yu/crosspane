import type { EngineName } from './types';

export const MAX_LOGS = 500;

// 트랙패드는 초당 수십 개의 wheel 이벤트를 발생시킨다.
// 이 간격 동안 델타를 모아 하나의 scroll 커맨드로 합쳐 백로그를 방지한다.
export const WHEEL_COALESCE_MS = 80;

export const RECONNECT_DELAY_MS = 1_000;

export const ENGINE_LABEL: Record<EngineName, string> = {
  chromium: 'Chromium · Android WebView',
  webkit: 'WebKit · iOS WKWebView',
  firefox: 'Firefox · Gecko',
};
