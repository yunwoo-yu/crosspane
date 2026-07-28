import { describe, expect, it } from 'vitest';
import type { EngineName } from '../src/protocol';
import { hasDivergedUrls, normalizeUrl, pickLeader, planUrlSync } from '../src/url-sync';

const urls = (entries: [EngineName, string][]) => new Map(entries);

describe('planUrlSync', () => {
  it('리더(chromium)와 다른 팔로워를 수렴 대상으로 잡는다', () => {
    const plans = planUrlSync({
      urls: urls([
        ['chromium', 'http://localhost:3000/detail'],
        ['webkit', 'http://localhost:3000/'],
        ['firefox', 'http://localhost:3000/detail'],
      ]),
      syncable: ['chromium', 'webkit', 'firefox'],
      attempted: new Map(),
      now: 0,
    });
    expect(plans).toEqual([{ engine: 'webkit', target: 'http://localhost:3000/detail' }]);
  });

  it('같은 목표 재시도는 쿨다운 내에는 미루고, 지나면 다시 수렴한다', () => {
    const attempted = new Map([
      ['webkit' as const, { target: normalizeUrl('http://localhost:3000/page'), ts: 1_000 }],
    ]);
    const input = {
      urls: urls([
        ['chromium', 'http://localhost:3000/page'],
        ['webkit', 'http://localhost:3000/login'],
      ]),
      syncable: ['chromium', 'webkit'] as const,
      attempted,
    };
    expect(planUrlSync({ ...input, now: 2_000 })).toEqual([]); // 쿨다운 중
    expect(planUrlSync({ ...input, now: 5_500 })).toEqual([
      { engine: 'webkit', target: 'http://localhost:3000/page' },
    ]); // 쿨다운 경과 — 계속 되돌린다
  });

  it('트레일링 슬래시 차이는 어긋남으로 보지 않는다', () => {
    const plans = planUrlSync({
      urls: urls([
        ['chromium', 'http://localhost:3000'],
        ['webkit', 'http://localhost:3000/'],
      ]),
      syncable: ['chromium', 'webkit'],
      attempted: new Map(),
      now: 0,
    });
    expect(plans).toEqual([]);
  });

  it('아직 내비게이션 전인 엔진은 건드리지 않는다', () => {
    const plans = planUrlSync({
      urls: urls([['chromium', 'http://localhost:3000/a']]),
      syncable: ['chromium', 'webkit'],
      attempted: new Map(),
      now: 0,
    });
    expect(plans).toEqual([]);
  });
});

describe('pickLeader', () => {
  it('chromium > webkit > firefox 우선순위', () => {
    expect(pickLeader(['firefox', 'webkit'])).toBe('webkit');
    expect(pickLeader(['firefox'])).toBe('firefox');
    expect(pickLeader([])).toBeUndefined();
  });
});

describe('hasDivergedUrls', () => {
  it('리더와 다른 팔로워가 있으면 true (쿨다운과 무관한 재예약 판단)', () => {
    const navUrls = new Map<EngineName, string>([
      ['chromium', 'http://localhost:3000/a'],
      ['webkit', 'http://localhost:3000/b'],
    ]);
    expect(hasDivergedUrls(navUrls, ['chromium', 'webkit'])).toBe(true);
  });

  it('전부 일치(정규화 포함)하면 false', () => {
    const navUrls = new Map<EngineName, string>([
      ['chromium', 'http://localhost:3000/'],
      ['webkit', 'http://localhost:3000'],
    ]);
    expect(hasDivergedUrls(navUrls, ['chromium', 'webkit'])).toBe(false);
  });

  it('리더 URL 미확정이거나 syncable이 비면 false', () => {
    expect(hasDivergedUrls(new Map(), ['chromium'])).toBe(false);
    expect(hasDivergedUrls(new Map(), [])).toBe(false);
  });
});
