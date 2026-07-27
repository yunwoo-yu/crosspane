import { describe, expect, it } from 'vitest';
import { buildReportHtml } from '../src/report-utils';
import type { LogEntry, NetworkEntry } from '../src/types';

const log = (overrides: Partial<LogEntry>): LogEntry => ({
  id: 1,
  engine: 'chromium',
  kind: 'console',
  level: 'log',
  text: 'hello',
  ts: 0,
  ...overrides,
});

const network = (overrides: Partial<NetworkEntry>): NetworkEntry => ({
  id: 1,
  engine: 'webkit',
  method: 'GET',
  url: 'http://localhost:3000/api/me',
  status: 200,
  resourceType: 'fetch',
  durationMs: 12,
  ts: 0,
  ...overrides,
});

describe('buildReportHtml', () => {
  const html = buildReportHtml({
    targetUrl: 'http://localhost:3000',
    device: 'iPhone 15',
    generatedAt: new Date('2026-07-27T12:00:00Z'),
    engines: [
      {
        engine: 'chromium',
        currentUrl: 'http://localhost:3000/',
        status: 'ready',
        screenshotDataUrl: 'data:image/jpeg;base64,abc',
      },
      { engine: 'webkit' },
    ],
    logs: [
      log({ text: '<script>alert(1)</script>', level: 'error' }),
      log({ id: 2, text: 'plain' }),
    ],
    networkEntries: [network({}), network({ id: 2, status: 401 })],
  });

  it('자급자족 HTML — 외부 리소스 참조가 없다', () => {
    expect(html).toContain('<!doctype html>');
    expect(html).not.toMatch(/src="http/);
    expect(html).not.toMatch(/href="http/);
  });

  it('스크린샷은 data URI로 임베드, 프레임 없는 엔진은 no frame', () => {
    expect(html).toContain('data:image/jpeg;base64,abc');
    expect(html).toContain('no frame');
  });

  it('로그 텍스트를 이스케이프한다 (XSS 방지)', () => {
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  it('에러와 4xx/5xx가 상단 섹션으로 분리된다', () => {
    expect(html).toMatch(/Errors <span class="badge">1<\/span>/);
    expect(html).toMatch(/Failed requests \(4xx\/5xx\) <span class="badge">1<\/span>/);
  });
});
