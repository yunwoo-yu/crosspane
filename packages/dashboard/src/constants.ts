import type { EngineName } from './types';

export const MAX_LOGS = 500;

export const ENGINE_LABEL: Record<EngineName, string> = {
  chromium: 'Chromium · Android WebView',
  webkit: 'WebKit · iOS WKWebView',
  firefox: 'Firefox · Gecko',
};
