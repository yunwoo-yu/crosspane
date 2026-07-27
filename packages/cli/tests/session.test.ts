import { describe, expect, it } from 'vitest';
import { buildWebviewUserAgent, isAbortedRequestError } from '../src/session';

const PRESET_CHROMIUM_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/119.0.6045.109 Chrome/131.0.6778.33 Version/17.2 Mobile/15E148 Safari/604.1';
const PRESET_WEBKIT_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1';

describe('buildWebviewUserAgent', () => {
  it('chromium은 Android WebView UA를 만든다 ("wv" 토큰 + 프리셋 Chrome 버전 유지)', () => {
    const ua = buildWebviewUserAgent('chromium', PRESET_CHROMIUM_UA);
    expect(ua).toContain('; wv)'); // 앱들이 웹뷰 감지에 쓰는 토큰
    expect(ua).toContain('Version/4.0');
    expect(ua).toContain('Chrome/131.0.6778.33');
    expect(ua).toContain('Android');
  });

  it('webkit은 WKWebView UA를 만든다 (Safari 브라우저 토큰 없음)', () => {
    const ua = buildWebviewUserAgent('webkit', PRESET_WEBKIT_UA);
    expect(ua).toContain('iPhone OS');
    expect(ua).toContain('Mobile/15E148');
    // WKWebView는 Safari 앱과 달리 "Version/x ... Safari/x" 토큰이 없다
    expect(ua).not.toContain('Safari/');
    expect(ua).not.toMatch(/Version\/\d/);
  });

  it('firefox는 대응 웹뷰가 없어 undefined (프리셋 유지)', () => {
    expect(buildWebviewUserAgent('firefox', 'whatever')).toBeUndefined();
  });
});

describe('isAbortedRequestError', () => {
  it('엔진별 요청 취소 에러를 정상 동작으로 판별한다', () => {
    expect(isAbortedRequestError('net::ERR_ABORTED')).toBe(true); // Chromium (Next.js prefetch 취소)
    expect(isAbortedRequestError('NS_BINDING_ABORTED')).toBe(true); // Firefox
    expect(isAbortedRequestError('NS_ERROR_ABORT')).toBe(true); // Firefox
    expect(isAbortedRequestError('cancelled')).toBe(true); // WebKit
    expect(isAbortedRequestError('Load request cancelled')).toBe(true); // WebKit
    expect(isAbortedRequestError('canceled')).toBe(true); // 철자 변형
  });

  it('진짜 네트워크 에러는 걸러내지 않는다', () => {
    expect(isAbortedRequestError('net::ERR_CONNECTION_REFUSED')).toBe(false);
    expect(isAbortedRequestError('net::ERR_NAME_NOT_RESOLVED')).toBe(false);
    expect(isAbortedRequestError('NS_ERROR_UNKNOWN_HOST')).toBe(false);
    expect(isAbortedRequestError('timeout')).toBe(false);
  });
});
