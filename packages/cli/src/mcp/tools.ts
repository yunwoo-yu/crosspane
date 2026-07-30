import type { SessionEvent } from '@crosspane/protocol';
import type { SessionStore, StoredSession } from './store.js';

/**
 * MCP 툴 정의 + 핸들러. 전송·JSON-RPC와 분리된 순수 계층이라 스토어만 주면 테스트된다.
 *
 * 출력은 JSON이 아니라 줄 단위 텍스트다. 소비자가 LLM이므로 같은 정보를 절반 이하
 * 토큰으로 싣는 쪽이 낫고, 사람이 대화창에서 읽을 때도 그대로 읽힌다.
 */

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
}

const SESSION_PARAM = {
  session: {
    type: 'string',
    description:
      'Session id, exact label, or a substring of the label. Omit when only one session exists.',
  },
} as const;

const LIMIT_PARAM = {
  limit: {
    type: 'integer',
    description: `Max entries, newest last (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).`,
  },
} as const;

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'list_sessions',
    description:
      'List web sessions attached to the crosspane hub (webviews, in-app browsers, kiosks) with per-session event counts. Call this first to discover session ids.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_errors',
    description:
      'Everything that went wrong in a session, in order: uncaught exceptions, console errors, and failed/blocked network requests. Start here when asked why a screen broke.',
    inputSchema: { type: 'object', properties: { ...SESSION_PARAM, ...LIMIT_PARAM } },
  },
  {
    name: 'get_console',
    description: 'Console output and uncaught exceptions for a session.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SESSION_PARAM,
        ...LIMIT_PARAM,
        level: {
          type: 'string',
          description: 'Keep only this console level (log, info, warning, error, debug).',
        },
        contains: { type: 'string', description: 'Keep only entries containing this text.' },
      },
    },
  },
  {
    name: 'get_network',
    description: 'HTTP requests observed in a session (fetch and XHR), with status and duration.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SESSION_PARAM,
        ...LIMIT_PARAM,
        failedOnly: {
          type: 'boolean',
          description: 'Keep only requests that failed — no response, or status >= 400.',
        },
        contains: { type: 'string', description: 'Keep only requests whose URL contains this.' },
      },
    },
  },
  {
    name: 'get_timeline',
    description:
      'All events for a session in chronological order — navigations interleaved with console and network. Use to see what happened around a failure.',
    inputSchema: { type: 'object', properties: { ...SESSION_PARAM, ...LIMIT_PARAM } },
  },
];

export interface ToolResult {
  text: string;
  isError?: boolean;
}

export interface ToolContext {
  store: SessionStore;
  /** 허브 연결 상태 — "세션 0개"가 연결 실패인지 정말 없는 건지 구분해 준다 */
  hubConnected: () => boolean;
  /**
   * 첫 연결 시도가 끝날 때까지 기다린다 (성공이든 실패든).
   *
   * 클라이언트는 서버를 띄운 직후 곧바로 툴을 부른다. 그 시점엔 WS 핸드셰이크가
   * 아직 진행 중이라 이 대기가 없으면 "허브 미연결"이라고 거짓 보고한다 (실측).
   * 재접속 중에는 기다리지 않는다 — 끊긴 사실을 즉시 알리는 게 맞다.
   */
  waitForHub: () => Promise<void>;
  hubUrl: string;
}

export function callTool(name: string, rawArgs: unknown, ctx: ToolContext): ToolResult {
  const args = (typeof rawArgs === 'object' && rawArgs !== null ? rawArgs : {}) as Record<
    string,
    unknown
  >;
  switch (name) {
    case 'list_sessions':
      return listSessions(ctx);
    case 'get_errors':
      return withSession(args, ctx, (session) => getErrors(session, limitOf(args)));
    case 'get_console':
      return withSession(args, ctx, (session) =>
        getConsole(session, limitOf(args), stringOf(args.level), stringOf(args.contains)),
      );
    case 'get_network':
      return withSession(args, ctx, (session) =>
        getNetwork(session, limitOf(args), args.failedOnly === true, stringOf(args.contains)),
      );
    case 'get_timeline':
      return withSession(args, ctx, (session) => getTimeline(session, limitOf(args)));
    default:
      return { text: `Unknown tool: ${name}`, isError: true };
  }
}

// ── 세션 선택 ────────────────────────────────────────────────────

/**
 * 세션을 못 찾으면 후보 목록을 함께 돌려준다 — 에이전트가 되묻지 않고
 * 다음 호출에서 스스로 고칠 수 있게 하는 것이 왕복을 줄이는 유일한 방법이다.
 */
function withSession(
  args: Record<string, unknown>,
  ctx: ToolContext,
  handler: (session: StoredSession) => ToolResult,
): ToolResult {
  const selector = stringOf(args.session);
  const session = ctx.store.resolve(selector);
  if (session) return handler(session);

  const sessions = ctx.store.list();
  if (sessions.length === 0) {
    return {
      text: ctx.hubConnected()
        ? `No sessions yet. The hub at ${ctx.hubUrl} is connected but no page has attached the @crosspane/agent SDK.`
        : `Not connected to the crosspane hub at ${ctx.hubUrl}. Start it with \`crosspane\` (or pass --hub).`,
      isError: true,
    };
  }
  const known = sessions.map((s) => `  ${s.meta.id}  "${s.meta.label}"`).join('\n');
  return {
    text:
      selector === undefined
        ? `${sessions.length} sessions available — pass one as "session":\n${known}`
        : `No session matches "${selector}". Available:\n${known}`,
    isError: true,
  };
}

// ── 툴 구현 ──────────────────────────────────────────────────────

function listSessions(ctx: ToolContext): ToolResult {
  const sessions = ctx.store.list();
  const header = ctx.hubConnected()
    ? `hub ${ctx.hubUrl} — connected`
    : `hub ${ctx.hubUrl} — NOT connected (start it with \`crosspane\`)`;
  if (sessions.length === 0) return { text: `${header}\n\nNo sessions.` };

  const blocks = sessions.map((session) => {
    const { meta } = session;
    const counts = countEvents(session.events);
    const lines = [
      `${meta.id}  ${session.live ? '● live' : '○ ended'}  "${meta.label}"${
        meta.platform ? `  [${meta.platform}]` : ''
      }`,
      `  started ${new Date(meta.startedAt).toISOString()}`,
    ];
    if (meta.url) lines.push(`  url ${meta.url}`);
    lines.push(
      `  ${counts.console} console, ${counts.network} network, ${counts.errors} errors, ${counts.navigation} navigations, ${counts.interaction} interactions` +
        (session.dropped > 0 ? ` (+${session.dropped} older events dropped)` : ''),
    );
    return lines.join('\n');
  });
  return { text: `${header}\n\n${blocks.join('\n\n')}` };
}

function getErrors(session: StoredSession, limit: number): ToolResult {
  const failures = session.events.filter(
    (event) =>
      event.type === 'pageerror' ||
      (event.type === 'console' && event.level === 'error') ||
      (event.type === 'network' && isFailedRequest(event)),
  );
  if (failures.length === 0) {
    return { text: `${describe(session)}\n\nNo errors recorded.` };
  }
  return { text: render(session, failures, limit) };
}

function getConsole(
  session: StoredSession,
  limit: number,
  level: string | undefined,
  contains: string | undefined,
): ToolResult {
  const needle = contains?.toLowerCase();
  const entries = session.events.filter((event) => {
    if (event.type === 'pageerror') return level === undefined || level === 'error';
    if (event.type !== 'console') return false;
    if (level !== undefined && event.level !== level) return false;
    return needle === undefined || event.text.toLowerCase().includes(needle);
  });
  return { text: render(session, entries, limit) };
}

function getNetwork(
  session: StoredSession,
  limit: number,
  failedOnly: boolean,
  contains: string | undefined,
): ToolResult {
  const needle = contains?.toLowerCase();
  const entries = session.events.filter((event) => {
    if (event.type !== 'network') return false;
    if (failedOnly && !isFailedRequest(event)) return false;
    return needle === undefined || event.url.toLowerCase().includes(needle);
  });
  return { text: render(session, entries, limit) };
}

function getTimeline(session: StoredSession, limit: number): ToolResult {
  return { text: render(session, session.events, limit) };
}

// ── 포맷 ─────────────────────────────────────────────────────────

function render(session: StoredSession, events: SessionEvent[], limit: number): string {
  const header = describe(session);
  if (events.length === 0) return `${header}\n\nNo matching events.`;
  // 오래된 것을 자른다 — 실패는 보통 마지막에 있고, 앞을 자르면 원인 직전 맥락이 남는다
  const shown = events.slice(-limit);
  const omitted = events.length - shown.length;
  const notice = omitted > 0 ? `\n(${omitted} older matching events omitted)` : '';
  return `${header}${notice}\n\n${shown.map(formatEvent).join('\n')}`;
}

function describe(session: StoredSession): string {
  const state = session.live ? 'live' : 'ended';
  const dropped = session.dropped > 0 ? `, ${session.dropped} oldest events dropped` : '';
  return `${session.meta.id} "${session.meta.label}" (${state}, ${session.events.length} events${dropped})`;
}

function formatEvent(event: SessionEvent): string {
  const at = `[${new Date(event.ts).toISOString().slice(11, 23)}]`;
  switch (event.type) {
    case 'console':
      return `${at} ${event.level.padEnd(7)} ${event.text}${repeatSuffix(event)}`;
    case 'pageerror':
      // 스택은 들여쓰기해 이어붙인다 — 한 이벤트가 여러 줄이어도 시각적으로 하나다
      return `${at} EXCEPTION ${event.message}${repeatSuffix(event)}${
        event.stack ? `\n${indent(event.stack)}` : ''
      }`;
    case 'network': {
      // 모름(리소스 타이밍 관측)을 'FAILED'로 적으면 에이전트가 오답한다
      const status =
        event.status === undefined ? '—' : event.status === 0 ? 'FAILED' : String(event.status);
      const reason = event.error ? ` — ${event.error}` : '';
      const body = event.bodyPreview
        ? `\n${indent(event.bodyPreview + (event.bodyTruncated ? ' …[truncated]' : ''))}`
        : '';
      return `${at} ${status.padEnd(7)} ${event.method} ${event.url} (${Math.round(event.durationMs)}ms)${reason}${body}`;
    }
    case 'navigation':
      return `${at} NAV     ${event.url}`;
    case 'screen':
      return `${at} screen  (${event.format} recording chunk)`;
    case 'interaction': {
      // 코딩 에이전트가 재현 절차를 읽을 수 있게 — "무엇을 눌렀더니"가 원인 추적의 시작이다
      const extra =
        event.key !== undefined
          ? ` [${event.key}]`
          : event.valueLength !== undefined
            ? ` (${event.valueLength} chars)`
            : '';
      return `${at} USER    ${event.kind} ${event.target}${extra}`;
    }
    case 'vital': {
      const value = event.name === 'CLS' ? event.value.toFixed(3) : `${Math.round(event.value)}ms`;
      return `${at} PERF    ${event.name} ${value}${event.detail === undefined ? '' : ` ${event.detail}`}`;
    }
  }
}

/**
 * 반복 횟수와 이어진 기간. **빠뜨리면 안 된다** — 대시보드는 `×3000 10m`을 보여주는데
 * MCP가 한 줄만 내면 코딩 에이전트는 한 번 일어난 일로 읽는다. 같은 데이터에서
 * 두 소비자가 다른 결론에 도달하면 "대시보드가 보는 것은 에이전트도 본다"는 전제가 깨진다.
 */
function repeatSuffix(event: Extract<SessionEvent, { type: 'console' | 'pageerror' }>): string {
  const repeat = event.repeat ?? 1;
  if (repeat <= 1) return '';
  const span = event.repeatUntil === undefined ? '' : formatSpan(event.repeatUntil - event.ts);
  return `  (×${repeat}${span ? ` over ${span}, still recurring` : ''})`;
}

/** 1초 미만은 기간을 붙이지 않는다 — 순간적 폭주에 기간은 의미가 없다 */
function formatSpan(ms: number): string {
  if (ms < 1_000) return '';
  const seconds = Math.round(ms / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`;
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `        ${line}`)
    .join('\n');
}

// ── 유틸 ─────────────────────────────────────────────────────────

function isFailedRequest(event: Extract<SessionEvent, { type: 'network' }>): boolean {
  // status 없음 = 모름이지 실패가 아니다 (리소스 타이밍으로 관측된 요청).
  // 실패로 세면 코딩 에이전트가 멀쩡한 이미지를 원인으로 지목한다
  if (event.status === undefined) return false;
  return event.status === 0 || event.status >= 400;
}

function countEvents(events: SessionEvent[]): {
  console: number;
  network: number;
  errors: number;
  navigation: number;
  interaction: number;
} {
  const counts = { console: 0, network: 0, errors: 0, navigation: 0, interaction: 0 };
  for (const event of events) {
    if (event.type === 'console') {
      // 합쳐진 이벤트는 실제 발생 횟수로 센다 — 1건으로 세면 "에러 1개"로 오도한다
      const times = event.repeat ?? 1;
      counts.console += times;
      if (event.level === 'error') counts.errors += times;
    } else if (event.type === 'network') {
      counts.network += 1;
      if (isFailedRequest(event)) counts.errors += 1;
    } else if (event.type === 'pageerror') {
      counts.errors += event.repeat ?? 1;
    } else if (event.type === 'navigation') {
      counts.navigation += 1;
    } else if (event.type === 'interaction') {
      counts.interaction += 1;
    }
  }
  return counts;
}

function limitOf(args: Record<string, unknown>): number {
  const raw = args.limit;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(raw), MAX_LIMIT);
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}
