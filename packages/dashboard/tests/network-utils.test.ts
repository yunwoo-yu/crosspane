import { describe, expect, it } from 'vitest';
import {
  filterNetworkEntries,
  formatDuration,
  isErrorStatus,
  statusTone,
} from '../src/network-utils';
import type { NetworkEntry } from '../src/types';

const entry = (partial: Partial<NetworkEntry>): NetworkEntry => ({
  id: 0,
  sessionId: 'a',
  method: 'GET',
  url: 'http://api/x',
  status: 200,
  durationMs: 10,
  initiator: 'fetch',
  ts: 0,
  ...partial,
});

describe('statusTone / isErrorStatus', () => {
  it('status 0(응답 못 받음)과 4xx/5xx는 에러', () => {
    expect(isErrorStatus(0)).toBe(true);
    expect(isErrorStatus(404)).toBe(true);
    expect(isErrorStatus(302)).toBe(false);
    expect(statusTone(0)).toBe('error');
    expect(statusTone(302)).toBe('redirect');
    expect(statusTone(200)).toBe('ok');
  });
});

describe('filterNetworkEntries', () => {
  const entries = [
    entry({ id: 1, url: 'http://api/users', ts: 1 }),
    entry({ id: 2, url: 'http://cdn/app.js', initiator: 'script', ts: 2 }),
    entry({ id: 3, url: 'http://api/pay', status: 500, ts: 3 }),
    entry({ id: 4, url: 'http://api/other', sessionId: 'b', ts: 4 }),
  ];

  it('xhrOnly는 initiator를 아는 정적 리소스만 숨긴다', () => {
    const rows = filterNetworkEntries(entries, { xhrOnly: true, errorsOnly: false, search: '' });
    expect(rows.map((r) => r.id)).not.toContain(2);
  });

  it('errorsOnly / search / sessionId 필터', () => {
    expect(
      filterNetworkEntries(entries, { xhrOnly: false, errorsOnly: true, search: '' }).map(
        (r) => r.id,
      ),
    ).toEqual([3]);
    expect(
      filterNetworkEntries(entries, { xhrOnly: false, errorsOnly: false, search: 'USERS' }).map(
        (r) => r.id,
      ),
    ).toEqual([1]);
    expect(
      filterNetworkEntries(entries, {
        xhrOnly: false,
        errorsOnly: false,
        search: '',
        sessionId: 'b',
      }).map((r) => r.id),
    ).toEqual([4]);
  });

  it('최신 요청이 위로 정렬된다', () => {
    const rows = filterNetworkEntries(entries, { xhrOnly: false, errorsOnly: false, search: '' });
    expect(rows.map((r) => r.ts)).toEqual([4, 3, 2, 1]);
  });
});

describe('formatDuration', () => {
  it('1초 이상은 초 단위로', () => {
    expect(formatDuration(250)).toBe('250ms');
    expect(formatDuration(1500)).toBe('1.50s');
    expect(formatDuration(-1)).toBe('—');
  });
});
