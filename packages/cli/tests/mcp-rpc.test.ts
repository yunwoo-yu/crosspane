import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { serveStdio, toWebSocketUrl } from '../src/mcp/index.js';
import { handleRpcMessage, type JsonRpcResponse, MCP_PROTOCOL_VERSION } from '../src/mcp/rpc.js';
import { SessionStore } from '../src/mcp/store.js';
import type { ToolContext } from '../src/mcp/tools.js';

/** 응답이 있어야 하는 요청 — 없으면 테스트 실패로 끊는다 (옵셔널 체인 전파 방지) */
async function respond(message: unknown): Promise<JsonRpcResponse> {
  const response = await handleRpcMessage(message, context());
  if (!response) throw new Error('expected a response, got none');
  return response;
}

function context(): ToolContext {
  return {
    store: new SessionStore(),
    hubConnected: () => true,
    waitForHub: () => Promise.resolve(),
    hubUrl: 'http://127.0.0.1:7788',
  };
}

describe('handleRpcMessage', () => {
  it('initialize에 tools 능력과 서버 정보를 돌려준다', async () => {
    const response = await respond({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    const result = response.result as {
      protocolVersion: string;
      capabilities: Record<string, unknown>;
      serverInfo: { name: string; version: string };
    };
    expect(response.id).toBe(1);
    expect(result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect(result.capabilities).toHaveProperty('tools');
    expect(result.serverInfo.name).toBe('crosspane');
    expect(result.serverInfo.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('클라이언트가 요구한 버전이 지원 범위면 그 버전으로 합의한다', async () => {
    const response = await respond({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05' },
    });
    expect((response.result as { protocolVersion: string }).protocolVersion).toBe('2024-11-05');
  });

  it('모르는 버전을 요구하면 우리 버전을 제시한다', async () => {
    const response = await respond({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '1999-01-01' },
    });
    expect((response.result as { protocolVersion: string }).protocolVersion).toBe(
      MCP_PROTOCOL_VERSION,
    );
  });

  it('알림에는 응답하지 않는다 — 응답하면 스펙 위반이다', async () => {
    expect(
      await handleRpcMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, context()),
    ).toBe(null);
  });

  it('tools/list가 스키마를 붙여 툴을 나열한다', async () => {
    const response = await respond({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const tools = (response.result as { tools: { name: string }[] }).tools;
    expect(tools.map((tool) => tool.name)).toContain('list_sessions');
  });

  it('tools/call은 text 컨텐츠를 돌려준다', async () => {
    const response = await respond({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'list_sessions' },
    });
    const result = response.result as {
      content: { type: string; text: string }[];
      isError: boolean;
    };
    expect(result.isError).toBe(false);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('No sessions');
  });

  it('툴 실행 실패는 isError 결과다 — 프로토콜 오류가 아니어야 모델이 스스로 고친다', async () => {
    const response = await respond({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'get_errors' },
    });
    expect(response.error).toBeUndefined();
    expect((response.result as { isError: boolean }).isError).toBe(true);
  });

  it('name 없는 tools/call은 invalid params', async () => {
    const response = await respond({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: {} });
    expect(response.error?.code).toBe(-32602);
  });

  it('모르는 메서드는 method not found', async () => {
    const response = await respond({ jsonrpc: '2.0', id: 6, method: 'resources/list' });
    expect(response.error?.code).toBe(-32601);
  });

  it('ping에 빈 결과로 답한다', async () => {
    expect((await respond({ jsonrpc: '2.0', id: 7, method: 'ping' })).result).toEqual({});
  });
});

describe('serveStdio', () => {
  async function exchange(input: string): Promise<string[]> {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const lines: string[] = [];
    let buffer = '';
    stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        lines.push(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
      }
    });
    serveStdio(stdin, stdout, context());
    stdin.write(input);
    await new Promise((resolve) => setImmediate(resolve));
    return lines;
  }

  it('요청 하나에 JSON 한 줄로 답한다', async () => {
    const lines = await exchange('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
  });

  it('한 청크에 붙어 온 여러 요청을 모두 처리한다', async () => {
    const lines = await exchange(
      '{"jsonrpc":"2.0","id":1,"method":"ping"}\n{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n',
    );
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]).id).toBe(2);
  });

  it('청크 경계에서 잘린 줄을 이어붙인다', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));
    serveStdio(stdin, stdout, context());
    stdin.write('{"jsonrpc":"2.0","id":9,"me');
    await new Promise((resolve) => setImmediate(resolve));
    expect(chunks).toHaveLength(0);
    stdin.write('thod":"ping"}\n');
    await new Promise((resolve) => setImmediate(resolve));
    expect(JSON.parse(chunks.join('')).id).toBe(9);
  });

  it('깨진 JSON은 parse error로 답하고 죽지 않는다', async () => {
    const lines = await exchange('not json\n{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
    expect(JSON.parse(lines[0]).error.code).toBe(-32700);
    expect(JSON.parse(lines[1]).result).toEqual({});
  });

  it('stdin이 닫혀도 처리 중이던 응답을 먼저 쓴 뒤 종료를 알린다', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const written: string[] = [];
    let ended = false;
    stdout.on('data', (chunk: Buffer) => written.push(chunk.toString()));
    // 허브 연결을 기다리는 tools/call — 파이프로 입력을 주는 클라이언트라면
    // 즉시 종료 시 이 응답이 잘려 나간다 (실측된 버그)
    const ctx = context();
    ctx.waitForHub = () => new Promise((resolve) => setTimeout(resolve, 30));
    serveStdio(stdin, stdout, ctx, () => {
      ended = true;
    });
    stdin.end('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_sessions"}}\n');

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(ended).toBe(true);
    expect(JSON.parse(written.join('')).id).toBe(1);
  });

  it('빈 줄은 무시한다', async () => {
    const lines = await exchange('\n\n{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
    expect(lines).toHaveLength(1);
  });
});

describe('toWebSocketUrl', () => {
  it('허브 http 주소를 대시보드 WS 엔드포인트로 바꾼다', () => {
    expect(toWebSocketUrl('http://127.0.0.1:7788')).toBe('ws://127.0.0.1:7788/ws');
    expect(toWebSocketUrl('https://hub.example.com')).toBe('wss://hub.example.com/ws');
    // 경로는 갈아치우고 쿼리(접속 토큰)는 남긴다 — 버리면 노출된 허브에서 401이 된다
    expect(toWebSocketUrl('http://127.0.0.1:7788/foo?t=abc')).toBe('ws://127.0.0.1:7788/ws?t=abc');
  });
});
