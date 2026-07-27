import { describe, expect, it } from 'vitest';
import { isMissingBrowserError } from '../src/browser-install';

describe('isMissingBrowserError', () => {
  it('Playwright 브라우저 미설치 에러를 감지한다', () => {
    expect(
      isMissingBrowserError(
        new Error("browserType.launch: Executable doesn't exist at /path/chrome-mac/Chromium.app"),
      ),
    ).toBe(true);
  });

  it('연결 거부 등 다른 에러는 설치 대상이 아니다', () => {
    expect(isMissingBrowserError(new Error('net::ERR_CONNECTION_REFUSED'))).toBe(false);
    expect(isMissingBrowserError(new Error('Timeout 30000ms exceeded'))).toBe(false);
  });
});
