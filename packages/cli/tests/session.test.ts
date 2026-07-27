import { describe, expect, it } from 'vitest';
import { isAbortedRequestError } from '../src/session';

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
