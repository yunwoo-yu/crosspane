import type { SessionEvent } from '@crosspane/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { SessionStore } from '../src/mcp/store.js';
import { callTool, TOOL_DEFINITIONS, type ToolContext } from '../src/mcp/tools.js';

let store: SessionStore;
let ctx: ToolContext;
let connected: boolean;

function seed(events: SessionEvent[]): void {
  store.apply({
    type: 'hello',
    sessions: [
      {
        id: 's1',
        label: 'checkout webview',
        userAgent: 'ua',
        platform: 'android-webview',
        url: 'https://shop.test/pay',
        startedAt: 1_000,
      },
    ],
  });
  for (const event of events) store.apply(event);
}

beforeEach(() => {
  store = new SessionStore();
  connected = true;
  ctx = {
    store,
    hubConnected: () => connected,
    waitForHub: () => Promise.resolve(),
    hubUrl: 'http://127.0.0.1:7788',
  };
});

describe('tool definitions', () => {
  it('이름이 유일하고 모두 object 스키마를 갖는다', () => {
    const names = TOOL_DEFINITIONS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });
});

describe('list_sessions', () => {
  it('허브 미연결이면 그렇게 말한다 — 세션 0개가 연결 실패인지 구분되어야 한다', () => {
    connected = false;
    const result = callTool('list_sessions', {}, ctx);
    expect(result.text).toContain('NOT connected');
    expect(result.isError).toBeUndefined();
  });

  it('세션 메타와 이벤트 집계를 싣는다', () => {
    seed([
      { type: 'console', sessionId: 's1', level: 'error', text: 'boom', ts: 2_000 },
      {
        type: 'network',
        sessionId: 's1',
        method: 'POST',
        url: 'https://api.test/pay',
        status: 500,
        durationMs: 12,
        ts: 3_000,
      },
      { type: 'navigation', sessionId: 's1', url: 'https://shop.test/pay', ts: 1_500 },
    ]);
    const result = callTool('list_sessions', {}, ctx);
    expect(result.text).toContain('checkout webview');
    expect(result.text).toContain('android-webview');
    expect(result.text).toContain('1 console, 1 network, 2 errors, 1 navigations');
  });
});

describe('세션 해석 실패', () => {
  it('세션이 없으면 허브 상태에 맞는 안내를 준다', () => {
    const result = callTool('get_errors', {}, ctx);
    expect(result.isError).toBe(true);
    expect(result.text).toContain('No sessions yet');
  });

  it('선택자가 안 맞으면 후보를 나열해 스스로 고치게 한다', () => {
    seed([]);
    const result = callTool('get_errors', { session: 'nope' }, ctx);
    expect(result.isError).toBe(true);
    expect(result.text).toContain('s1');
    expect(result.text).toContain('checkout webview');
  });
});

describe('get_errors', () => {
  it('예외 · console error · 실패 요청만 시간순으로 모은다', () => {
    seed([
      { type: 'console', sessionId: 's1', level: 'log', text: 'noise', ts: 2_000 },
      { type: 'console', sessionId: 's1', level: 'error', text: 'bad state', ts: 2_100 },
      {
        type: 'network',
        sessionId: 's1',
        method: 'GET',
        url: 'https://api.test/ok',
        status: 200,
        durationMs: 5,
        ts: 2_200,
      },
      {
        type: 'network',
        sessionId: 's1',
        method: 'GET',
        url: 'https://cdn.test/x.js',
        status: 0,
        durationMs: 0,
        error: 'net::ERR_BLOCKED',
        ts: 2_300,
      },
      { type: 'pageerror', sessionId: 's1', message: 'undefined is not a function', ts: 2_400 },
    ]);
    const result = callTool('get_errors', {}, ctx);
    expect(result.text).toContain('bad state');
    expect(result.text).toContain('net::ERR_BLOCKED');
    expect(result.text).toContain('undefined is not a function');
    expect(result.text).not.toContain('noise');
    expect(result.text).not.toContain('api.test/ok');
  });

  it('에러가 없으면 없다고 말한다', () => {
    seed([{ type: 'console', sessionId: 's1', level: 'log', text: 'fine', ts: 2_000 }]);
    expect(callTool('get_errors', {}, ctx).text).toContain('No errors recorded');
  });
});

describe('get_console', () => {
  beforeEach(() => {
    seed([
      { type: 'console', sessionId: 's1', level: 'log', text: 'alpha', ts: 2_000 },
      { type: 'console', sessionId: 's1', level: 'warning', text: 'beta', ts: 2_100 },
      { type: 'pageerror', sessionId: 's1', message: 'gamma', stack: 'at f (a.js:1:1)', ts: 2_200 },
    ]);
  });

  it('예외도 콘솔 스트림에 포함한다 — 브라우저 콘솔과 같은 화면이어야 한다', () => {
    const text = callTool('get_console', {}, ctx).text;
    expect(text).toContain('alpha');
    expect(text).toContain('gamma');
    expect(text).toContain('at f (a.js:1:1)');
  });

  it('level로 걸러낸다', () => {
    const text = callTool('get_console', { level: 'warning' }, ctx).text;
    expect(text).toContain('beta');
    expect(text).not.toContain('alpha');
    expect(text).not.toContain('gamma');
  });

  it('contains로 걸러낸다', () => {
    const text = callTool('get_console', { contains: 'ALPH' }, ctx).text;
    expect(text).toContain('alpha');
    expect(text).not.toContain('beta');
  });
});

describe('get_network', () => {
  beforeEach(() => {
    seed([
      {
        type: 'network',
        sessionId: 's1',
        method: 'GET',
        url: 'https://api.test/ok',
        status: 200,
        durationMs: 5,
        ts: 2_000,
      },
      {
        type: 'network',
        sessionId: 's1',
        method: 'POST',
        url: 'https://api.test/pay',
        status: 502,
        durationMs: 1_204.6,
        bodyPreview: '{"error":"upstream"}',
        bodyTruncated: true,
        ts: 2_100,
      },
    ]);
  });

  it('상태·소요시간·바디 미리보기를 싣는다', () => {
    const text = callTool('get_network', {}, ctx).text;
    expect(text).toContain('200');
    expect(text).toContain('502     POST https://api.test/pay (1205ms)');
    expect(text).toContain('{"error":"upstream"} …[truncated]');
  });

  it('failedOnly는 4xx/5xx와 무응답만 남긴다', () => {
    const text = callTool('get_network', { failedOnly: true }, ctx).text;
    expect(text).toContain('/pay');
    expect(text).not.toContain('/ok');
  });
});

describe('get_timeline', () => {
  it('limit은 오래된 쪽을 자르고 잘렸음을 밝힌다', () => {
    const events: SessionEvent[] = Array.from({ length: 5 }, (_, index) => ({
      type: 'console',
      sessionId: 's1',
      level: 'log',
      text: `line${index}`,
      ts: 2_000 + index,
    }));
    seed(events);
    const text = callTool('get_timeline', { limit: 2 }, ctx).text;
    expect(text).toContain('3 older matching events omitted');
    expect(text).toContain('line3');
    expect(text).toContain('line4');
    expect(text).not.toContain('line0');
  });

  it('limit 상한을 넘겨도 안전하다', () => {
    seed([{ type: 'console', sessionId: 's1', level: 'log', text: 'x', ts: 2_000 }]);
    expect(callTool('get_timeline', { limit: 99_999 }, ctx).text).toContain('x');
  });
});

describe('알 수 없는 툴', () => {
  it('프로토콜 오류가 아니라 isError 결과로 돌려준다', () => {
    const result = callTool('nope', {}, ctx);
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Unknown tool');
  });
});

describe('반복 이벤트를 코딩 에이전트에게도 밝힌다', () => {
  it('×N과 이어진 기간을 출력에 싣는다 — 대시보드와 같은 사실을 봐야 한다', () => {
    seed([
      {
        type: 'console',
        sessionId: 's1',
        level: 'error',
        text: 'Failed to fetch',
        repeat: 3_000,
        repeatUntil: 600_000,
        ts: 0,
      },
    ]);
    const text = callTool('get_errors', {}, ctx).text;
    expect(text).toContain('×3000');
    expect(text).toContain('over 10m');
    expect(text).toContain('still recurring');
  });

  it('1초 미만 폭주는 기간을 붙이지 않는다', () => {
    seed([
      {
        type: 'console',
        sessionId: 's1',
        level: 'error',
        text: 'burst',
        repeat: 50,
        repeatUntil: 200,
        ts: 0,
      },
    ]);
    const text = callTool('get_errors', {}, ctx).text;
    expect(text).toContain('×50');
    expect(text).not.toContain('over');
  });

  it('반복이 1이면 표식을 붙이지 않는다', () => {
    seed([{ type: 'console', sessionId: 's1', level: 'error', text: 'once', ts: 0 }]);
    expect(callTool('get_errors', {}, ctx).text).not.toContain('×');
  });

  it('집계는 실제 발생 횟수로 센다 — 1건으로 세면 "에러 1개"로 오도한다', () => {
    seed([
      {
        type: 'console',
        sessionId: 's1',
        level: 'error',
        text: 'spam',
        repeat: 3_000,
        ts: 0,
      },
      { type: 'pageerror', sessionId: 's1', message: 'boom', repeat: 2, ts: 1 },
    ]);
    expect(callTool('list_sessions', {}, ctx).text).toContain('3002 errors');
  });

  it('예외의 스택은 반복 표식 뒤에 온다 (한 이벤트가 시각적으로 하나)', () => {
    seed([
      {
        type: 'pageerror',
        sessionId: 's1',
        message: 'boom',
        stack: 'at pay.js:1:1',
        repeat: 5,
        ts: 0,
      },
    ]);
    const lines = callTool('get_errors', {}, ctx).text.split('\n');
    const header = lines.findIndex((line) => line.includes('boom'));
    expect(lines[header]).toContain('×5');
    expect(lines[header + 1]).toContain('at pay.js:1:1');
  });
});

/**
 * 상호작용·성능 지표가 MCP 출력에 있어야 한다.
 *
 * 왜 중요한가: 대시보드에는 보이는데 MCP에 없으면 코딩 에이전트는 **재현 절차를 모른 채**
 * 원인을 추측한다. 같은 데이터에서 두 소비자가 다른 결론을 내는 것이 가장 나쁜 상태다.
 */
describe('상호작용·성능 지표', () => {
  it('타임라인에 사용자가 한 일과 성능 지표를 함께 낸다', () => {
    seed([
      { type: 'interaction', sessionId: 's1', kind: 'click', target: 'button#pay "결제"', ts: 1 },
      {
        type: 'interaction',
        sessionId: 's1',
        kind: 'input',
        target: 'input#card',
        valueLength: 16,
        ts: 2,
      },
      { type: 'vital', sessionId: 's1', name: 'LCP', value: 3200, detail: 'img', ts: 3 },
      { type: 'vital', sessionId: 's1', name: 'CLS', value: 0.25, ts: 4 },
    ]);
    const text = callTool('get_timeline', {}, ctx).text;

    expect(text).toContain('USER    click button#pay "결제"');
    // 값이 아니라 길이만 — 비밀번호가 MCP를 통해 새면 안 된다
    expect(text).toContain('(16 chars)');
    expect(text).toContain('PERF    LCP 3200ms img');
    // CLS는 시간이 아니라 비율이다 — ms를 붙이면 완전히 다른 뜻이 된다
    expect(text).toContain('PERF    CLS 0.250');
  });

  it('세션 목록이 상호작용 건수를 센다', () => {
    seed([
      { type: 'interaction', sessionId: 's1', kind: 'click', target: 'button', ts: 1 },
      { type: 'interaction', sessionId: 's1', kind: 'submit', target: 'form', ts: 2 },
    ]);
    expect(callTool('list_sessions', {}, ctx).text).toContain('2 interactions');
  });

  it('상태를 모르는 요청은 실패로 세지 않는다 — 에이전트가 멀쩡한 이미지를 원인으로 지목한다', () => {
    seed([
      {
        type: 'network',
        sessionId: 's1',
        method: 'GET',
        url: '/hero.png',
        durationMs: 5,
        initiator: 'img',
        observed: true,
        ts: 1,
      },
    ]);
    const errors = callTool('get_errors', {}, ctx).text;
    expect(errors).not.toContain('/hero.png');
    expect(callTool('get_timeline', {}, ctx).text).toContain('—');
  });
});
