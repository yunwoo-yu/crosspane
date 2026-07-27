import { mkdtempSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { serveDashboardFile } from '../src/static';

/** writeHead/end 호출 결과만 기록하는 최소 ServerResponse 대역 */
class MockResponse {
  statusCode = 0;
  headers: Record<string, string> = {};
  body = '';

  writeHead(code: number, headers?: Record<string, string>): this {
    this.statusCode = code;
    if (headers) this.headers = headers;
    return this;
  }

  end(body?: unknown): this {
    if (body !== undefined) this.body = String(body);
    return this;
  }
}

let dashboardDir: string;
let emptyDir: string;

async function request(rootDir: string, url: string): Promise<MockResponse> {
  const response = new MockResponse();
  await serveDashboardFile(
    rootDir,
    { url } as IncomingMessage,
    response as unknown as ServerResponse,
  );
  return response;
}

beforeAll(() => {
  dashboardDir = mkdtempSync(join(tmpdir(), 'crosspane-static-'));
  writeFileSync(join(dashboardDir, 'index.html'), '<html>dashboard</html>');
  writeFileSync(join(dashboardDir, 'app.js'), 'console.log(1);');
  emptyDir = mkdtempSync(join(tmpdir(), 'crosspane-empty-'));
});

describe('serveDashboardFile', () => {
  it('/ 요청에 index.html을 반환한다', async () => {
    const response = await request(dashboardDir, '/');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('dashboard');
  });

  it('확장자에 맞는 MIME 타입을 붙인다', async () => {
    const response = await request(dashboardDir, '/app.js');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/javascript');
  });

  it('쿼리스트링을 무시한다', async () => {
    const response = await request(dashboardDir, '/app.js?v=123');
    expect(response.statusCode).toBe(200);
  });

  it('없는 경로는 SPA 폴백으로 index.html을 준다', async () => {
    const response = await request(dashboardDir, '/some/route');
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('dashboard');
  });

  it('경로 탈출(../)은 403으로 거부한다', async () => {
    const response = await request(dashboardDir, '/../outside.txt');
    expect(response.statusCode).toBe(403);
  });

  it('대시보드 빌드가 없으면 404와 안내 메시지를 준다', async () => {
    const response = await request(emptyDir, '/');
    expect(response.statusCode).toBe(404);
    expect(response.body).toContain('dashboard build not found');
  });
});
