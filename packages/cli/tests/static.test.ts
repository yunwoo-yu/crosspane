import { mkdtempSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { serveStatic } from '../src/static';

/** writeHead/end 호출 결과만 기록하는 최소 ServerResponse 대역 */
class MockRes {
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

let root: string;
let emptyRoot: string;

async function request(rootDir: string, url: string): Promise<MockRes> {
  const res = new MockRes();
  await serveStatic(rootDir, { url } as IncomingMessage, res as unknown as ServerResponse);
  return res;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'crosspane-static-'));
  writeFileSync(join(root, 'index.html'), '<html>dashboard</html>');
  writeFileSync(join(root, 'app.js'), 'console.log(1);');
  emptyRoot = mkdtempSync(join(tmpdir(), 'crosspane-empty-'));
});

describe('serveStatic', () => {
  it('/ 요청에 index.html을 반환한다', async () => {
    const res = await request(root, '/');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('dashboard');
  });

  it('확장자에 맞는 MIME 타입을 붙인다', async () => {
    const res = await request(root, '/app.js');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/javascript');
  });

  it('쿼리스트링을 무시한다', async () => {
    const res = await request(root, '/app.js?v=123');
    expect(res.statusCode).toBe(200);
  });

  it('없는 경로는 SPA 폴백으로 index.html을 준다', async () => {
    const res = await request(root, '/some/route');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('dashboard');
  });

  it('경로 탈출(../)은 403으로 거부한다', async () => {
    const res = await request(root, '/../outside.txt');
    expect(res.statusCode).toBe(403);
  });

  it('대시보드 빌드가 없으면 404와 안내 메시지를 준다', async () => {
    const res = await request(emptyRoot, '/');
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('dashboard build not found');
  });
});
