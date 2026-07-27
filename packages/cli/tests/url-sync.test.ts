import { describe, expect, it } from 'vitest';
import type { EngineName } from '../src/protocol';
import { normalizeUrl, pickLeader, planUrlSync } from '../src/url-sync';

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
    });
    expect(plans).toEqual([{ engine: 'webkit', target: 'http://localhost:3000/detail' }]);
  });

  it('같은 목표로 이미 수렴 시도한 엔진은 보존한다 (실차이 신호)', () => {
    const plans = planUrlSync({
      urls: urls([
        ['chromium', 'http://localhost:3000/page'],
        ['webkit', 'http://localhost:3000/login'], // 수렴시켰는데 또 리다이렉트됨
      ]),
      syncable: ['chromium', 'webkit'],
      attempted: new Map([['webkit', normalizeUrl('http://localhost:3000/page')]]),
    });
    expect(plans).toEqual([]);
  });

  it('트레일링 슬래시 차이는 어긋남으로 보지 않는다', () => {
    const plans = planUrlSync({
      urls: urls([
        ['chromium', 'http://localhost:3000'],
        ['webkit', 'http://localhost:3000/'],
      ]),
      syncable: ['chromium', 'webkit'],
      attempted: new Map(),
    });
    expect(plans).toEqual([]);
  });

  it('아직 내비게이션 전인 엔진은 건드리지 않는다', () => {
    const plans = planUrlSync({
      urls: urls([['chromium', 'http://localhost:3000/a']]),
      syncable: ['chromium', 'webkit'],
      attempted: new Map(),
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
