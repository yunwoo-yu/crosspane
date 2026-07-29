import { describe, expect, it } from 'vitest';
import { mergeScreenEvents, trimScreenEvents } from '../src/screen-events';

const meta = (id: number) => ({ type: 4, id });
const fullSnapshot = (id: number) => ({ type: 2, id });
const incremental = (id: number) => ({ type: 3, id });

describe('trimScreenEvents', () => {
  it('상한 이하면 그대로 둔다 (같은 배열 참조 유지)', () => {
    const events = [meta(0), fullSnapshot(1), incremental(2)];
    expect(trimScreenEvents(events, 10)).toBe(events);
  });

  it('상한을 넘으면 체크포인트(FullSnapshot)에서 자른다', () => {
    const events = [
      meta(0),
      fullSnapshot(1),
      incremental(2),
      incremental(3),
      meta(4),
      fullSnapshot(5),
      incremental(6),
    ];
    const trimmed = trimScreenEvents(events, 4);
    // 두 번째 체크포인트부터 — Meta를 포함해야 재생기가 뷰포트를 안다
    expect(trimmed.map((e) => (e as { id: number }).id)).toEqual([4, 5, 6]);
  });

  it('Meta 없는 FullSnapshot도 시작점으로 삼는다', () => {
    const events = [incremental(0), incremental(1), fullSnapshot(2), incremental(3)];
    expect(trimScreenEvents(events, 2).map((e) => (e as { id: number }).id)).toEqual([2, 3]);
  });

  it('체크포인트가 없으면 상한을 넘겨서라도 유지한다 (자르면 재생 불가)', () => {
    const events = [meta(0), fullSnapshot(1), incremental(2), incremental(3), incremental(4)];
    // 상한 안(뒤쪽 2개)에는 FullSnapshot이 없다 — 앞을 버리면 재생이 깨진다
    const trimmed = trimScreenEvents(events, 2);
    expect(trimmed).toBe(events);
  });
});

describe('mergeScreenEvents', () => {
  it('세션별로 이어 붙이고 다른 세션은 건드리지 않는다', () => {
    const current = { a: [meta(0), fullSnapshot(1)], b: [fullSnapshot(9)] };
    const merged = mergeScreenEvents(current, { a: [incremental(2)] }, 100);
    expect(merged.a).toHaveLength(3);
    expect(merged.b).toBe(current.b); // 손대지 않은 세션은 참조 유지 → 불필요한 리렌더 방지
  });

  it('빈 배치는 무시한다', () => {
    const current = { a: [fullSnapshot(0)] };
    expect(mergeScreenEvents(current, { a: [] }, 100).a).toBe(current.a);
  });

  it('합친 뒤 상한을 적용한다', () => {
    const current = { a: [meta(0), fullSnapshot(1), incremental(2)] };
    const merged = mergeScreenEvents(current, { a: [meta(3), fullSnapshot(4), incremental(5)] }, 3);
    expect(merged.a.map((e) => (e as { id: number }).id)).toEqual([3, 4, 5]);
  });
});
