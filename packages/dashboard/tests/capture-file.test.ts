import { describe, expect, it } from 'vitest';
import { CaptureParseError, parseCaptureFile } from '../src/capture-file';

const validCapture = JSON.stringify({
  version: 1,
  session: { id: 's-1', label: 'checkout webview', userAgent: 'ua', startedAt: 0 },
  events: [
    { type: 'navigation', sessionId: 's-1', url: 'http://app/checkout', ts: 1 },
    { type: 'screen', sessionId: 's-1', format: 'rrweb', data: { type: 2 }, ts: 1 },
    { type: 'console', sessionId: 's-1', level: 'error', text: 'boom', ts: 2 },
    {
      type: 'network',
      sessionId: 's-1',
      method: 'POST',
      url: 'http://api/pay',
      status: 500,
      durationMs: 12,
      ts: 3,
    },
  ],
  exportedAt: 4,
});

describe('parseCaptureFile', () => {
  it('캡처 파일을 라이브와 같은 엔트리 모양으로 변환한다', () => {
    const loaded = parseCaptureFile(validCapture);
    expect(loaded.session.label).toBe('checkout webview');
    expect(loaded.logs.map((l) => l.kind)).toEqual(['navigation', 'console']);
    expect(loaded.networkEntries).toHaveLength(1);
    // 화면 이벤트는 로그/네트워크와 섞이지 않고 별도로 복원된다
    expect(loaded.screenEvents).toEqual([{ type: 2 }]);
    expect(loaded.networkEntries[0]).toMatchObject({ status: 500, url: 'http://api/pay' });
    // id는 패널 key로 쓰이므로 유일해야 한다
    const ids = [...loaded.logs, ...loaded.networkEntries].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('JSON이 아니거나 crosspane 캡처가 아니면 명확한 에러', () => {
    expect(() => parseCaptureFile('not json')).toThrow(CaptureParseError);
    expect(() => parseCaptureFile('{"version":99}')).toThrow(/version 1/);
    expect(() => parseCaptureFile('{"version":1,"session":{"id":"a"}}')).toThrow(CaptureParseError);
  });
});
