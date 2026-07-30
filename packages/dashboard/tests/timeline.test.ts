import { describe, expect, it } from 'vitest';
import { buildTimeline, countByKind, searchTimeline, type TimelineKind } from '../src/timeline';
import type { LogEntry, NetworkEntry } from '../src/types';

/**
 * 통합 타임라인의 계약: **인과가 시간순으로 읽혀야 한다**는 것과,
 * 필터 칩의 숫자와 실제로 보이는 것이 어긋나지 않아야 한다는 것.
 */

const ALL: Set<TimelineKind> = new Set([
  'console',
  'error',
  'network',
  'interaction',
  'vital',
  'navigation',
]);

let nextId = 0;
const log = (partial: Partial<LogEntry> = {}): LogEntry => ({
  id: nextId++,
  sessionId: 's1',
  kind: 'console',
  level: 'log',
  text: 'hello',
  ts: 0,
  ...partial,
});
const request = (partial: Partial<NetworkEntry> = {}): NetworkEntry => ({
  id: nextId++,
  sessionId: 's1',
  method: 'GET',
  url: 'https://api.test/pay',
  status: 200,
  durationMs: 10,
  ts: 0,
  ...partial,
});

describe('buildTimeline', () => {
  it('로그와 요청을 시간순 한 줄기로 합친다 — 인과가 여기서 읽힌다', () => {
    const items = buildTimeline(
      [
        log({ kind: 'interaction', text: 'click  button#pay "결제하기"', ts: 100 }),
        log({ level: 'error', text: 'payment failed', ts: 300 }),
      ],
      [request({ url: '/api/pay', status: 500, ts: 200 })],
      ALL,
    );

    // 눌렀다 → 요청이 실패했다 → 에러가 났다. 이 순서가 화면에서 보여야 한다
    expect(items.map((item) => item.kind)).toEqual(['interaction', 'network', 'error']);
  });

  it('꺼진 종류는 빼고 낸다', () => {
    const items = buildTimeline([log()], [request()], new Set<TimelineKind>(['console']));
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('console');
  });

  it('상태를 모르는 요청은 실패로 칠하지 않는다 — 모름과 실패는 다르다', () => {
    const [item] = buildTimeline([], [request({ status: undefined })], ALL);
    expect(item.bad).toBe(false);
    expect(item.text).toContain('—');
  });

  it('응답을 못 받은 요청은 실패로 칠한다', () => {
    const [item] = buildTimeline([], [request({ status: 0 })], ALL);
    expect(item.bad).toBe(true);
    expect(item.text).toContain('ERR');
  });
});

describe('countByKind', () => {
  it('에러 레벨 콘솔은 에러로 센다 — 필터가 종류를 정하는 방식과 같아야 한다', () => {
    const logs = [log({ level: 'error' }), log({ level: 'log' })];
    const counts = countByKind(logs, []);
    expect(counts.error).toBe(1);
    expect(counts.console).toBe(1);

    // 칩이 "에러 1"이라고 했으면 에러만 켰을 때 정확히 1건이 보여야 한다
    const shown = buildTimeline(logs, [], new Set<TimelineKind>(['error']));
    expect(shown).toHaveLength(counts.error);
  });
});

describe('searchTimeline', () => {
  it('본문과 라벨을 둘 다 본다 — GET으로도, URL로도 찾을 수 있어야 한다', () => {
    const items = buildTimeline([], [request({ method: 'POST', url: '/api/pay' })], ALL);
    expect(searchTimeline(items, 'post')).toHaveLength(1);
    expect(searchTimeline(items, '/api/pay')).toHaveLength(1);
    expect(searchTimeline(items, 'nope')).toHaveLength(0);
  });
});
