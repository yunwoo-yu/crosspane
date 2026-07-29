import { cliVersion } from '../args.js';
import { callTool, TOOL_DEFINITIONS, type ToolContext } from './tools.js';

/**
 * MCP(Model Context Protocol) JSON-RPC 디스패치 — 전송 계층과 분리된 순수 함수.
 *
 * `@modelcontextprotocol/sdk`를 쓰지 않는 이유: 우리가 필요한 것은 툴 전용 서버의
 * 5개 메서드뿐이고, SDK는 4MB가 넘는다. `crosspane`은 npx로 받는 CLI라 설치 크기가
 * 그대로 첫 실행 체감이 된다 (근거는 docs/decisions.md).
 */

/** 우리가 응답하는 기본 프로토콜 버전 */
export const MCP_PROTOCOL_VERSION = '2025-06-18';
/** 클라이언트가 이 중 하나를 요구하면 그 버전으로 합의한다 (스펙의 버전 협상) */
const SUPPORTED_PROTOCOL_VERSIONS = new Set(['2024-11-05', '2025-03-26', MCP_PROTOCOL_VERSION]);

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export const JSON_RPC_PARSE_ERROR = -32700;
const JSON_RPC_INVALID_REQUEST = -32600;
const JSON_RPC_METHOD_NOT_FOUND = -32601;
const JSON_RPC_INVALID_PARAMS = -32602;

export function errorResponse(
  id: string | number | null,
  code: number,
  message: string,
): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/**
 * 메시지 하나를 처리한다. 알림(id 없음)은 응답이 없으므로 null을 돌려준다 —
 * 알림에 응답을 보내면 스펙 위반이고 일부 클라이언트가 연결을 끊는다.
 */
export async function handleRpcMessage(
  message: unknown,
  ctx: ToolContext,
): Promise<JsonRpcResponse | null> {
  if (typeof message !== 'object' || message === null || Array.isArray(message)) {
    return errorResponse(null, JSON_RPC_INVALID_REQUEST, 'Invalid Request');
  }
  const { id, method, params } = message as { id?: unknown; method?: unknown; params?: unknown };
  const isNotification = id === undefined || id === null;
  const requestId = typeof id === 'string' || typeof id === 'number' ? id : null;

  if (typeof method !== 'string') {
    return isNotification
      ? null
      : errorResponse(requestId, JSON_RPC_INVALID_REQUEST, 'Invalid Request');
  }
  // 응답/알림은 우리가 요청을 보내지 않으므로 도착할 일이 없다 — 조용히 무시
  if (isNotification) return null;

  switch (method) {
    case 'initialize':
      return { jsonrpc: '2.0', id: requestId, result: initializeResult(params) };
    case 'ping':
      return { jsonrpc: '2.0', id: requestId, result: {} };
    case 'tools/list':
      return { jsonrpc: '2.0', id: requestId, result: { tools: TOOL_DEFINITIONS } };
    case 'tools/call':
      return toolsCall(requestId, params, ctx);
    default:
      return errorResponse(requestId, JSON_RPC_METHOD_NOT_FOUND, `Method not found: ${method}`);
  }
}

function initializeResult(params: unknown): unknown {
  const requested = (params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
  return {
    protocolVersion:
      typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.has(requested)
        ? requested
        : MCP_PROTOCOL_VERSION,
    capabilities: { tools: {} },
    serverInfo: { name: 'crosspane', version: cliVersion() },
    instructions:
      'crosspane exposes live browser sessions from devices where devtools are unavailable ' +
      '(webviews, in-app browsers, security-locked builds). Call list_sessions first, then ' +
      'get_errors to see what broke.',
  };
}

async function toolsCall(
  id: string | number | null,
  params: unknown,
  ctx: ToolContext,
): Promise<JsonRpcResponse> {
  const name = (params as { name?: unknown } | undefined)?.name;
  if (typeof name !== 'string') {
    return errorResponse(id, JSON_RPC_INVALID_PARAMS, 'tools/call requires a "name" string');
  }
  // 기동 직후의 첫 호출이 핸드셰이크를 앞질러 "미연결"이라 답하지 않게 한다
  await ctx.waitForHub();
  const args = (params as { arguments?: unknown }).arguments;
  // 툴 실행 실패는 프로토콜 오류가 아니라 isError 결과로 돌려준다 — 그래야 모델이
  // 대화를 이어가며 스스로 고칠 수 있다 (MCP 규약)
  let result: { text: string; isError?: boolean };
  try {
    result = callTool(name, args, ctx);
  } catch (err) {
    result = {
      text: `Tool ${name} failed: ${err instanceof Error ? err.message : String(err)}`,
      isError: true,
    };
  }
  return {
    jsonrpc: '2.0',
    id,
    result: {
      content: [{ type: 'text', text: result.text }],
      isError: result.isError === true,
    },
  };
}
