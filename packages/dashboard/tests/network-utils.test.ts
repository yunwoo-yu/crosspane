import { describe, expect, it } from 'vitest';
import { groupNetworkRows, statusTone } from '../src/network-utils';
import type { NetworkEntry } from '../src/types';

let idSeq = 0;
function entry(
  partial: Partial<NetworkEntry> & Pick<NetworkEntry, 'engine' | 'url'>,
): NetworkEntry {
  return {
    id: idSeq++,
    method: 'GET',
    status: 200,
    resourceType: 'fetch',
    durationMs: 10,
    ts: idSeq,
    ...partial,
  };
}

const noFilter = { xhrOnly: false, errorsOnly: false, search: '' };

describe('groupNetworkRows', () => {
  it('같은 요청을 한 행으로 묶고 엔진별 상태를 나란히 놓는다', () => {
    const rows = groupNetworkRows(
      [
        entry({ engine: 'chromium', url: '/api/me', status: 200, durationMs: 12 }),
        entry({ engine: 'webkit', url: '/api/me', status: 401, durationMs: 8 }),
      ],
      noFilter,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].perEngine.chromium?.status).toBe(200);
    expect(rows[0].perEngine.webkit?.status).toBe(401);
  });

  it('엔진 간 상태가 다르면 statusMismatch — "iOS만 401"을 자동 표시', () => {
    const rows = groupNetworkRows(
      [
        entry({ engine: 'chromium', url: '/api/me', status: 200 }),
        entry({ engine: 'webkit', url: '/api/me', status: 401 }),
        entry({ engine: 'chromium', url: '/api/list', status: 200 }),
        entry({ engine: 'webkit', url: '/api/list', status: 200 }),
      ],
      noFilter,
    );
    const byUrl = Object.fromEntries(rows.map((row) => [row.url, row.statusMismatch]));
    expect(byUrl['/api/me']).toBe(true);
    expect(byUrl['/api/list']).toBe(false);
  });

  it('xhrOnly 필터는 정적 리소스를 제외한다', () => {
    const rows = groupNetworkRows(
      [
        entry({ engine: 'chromium', url: '/app.css', resourceType: 'stylesheet' }),
        entry({ engine: 'chromium', url: '/api/me', resourceType: 'xhr' }),
      ],
      { ...noFilter, xhrOnly: true },
    );
    expect(rows.map((row) => row.url)).toEqual(['/api/me']);
  });

  it('errorsOnly는 4xx/5xx가 있는 행만 남긴다', () => {
    const rows = groupNetworkRows(
      [
        entry({ engine: 'chromium', url: '/ok', status: 200 }),
        entry({ engine: 'chromium', url: '/boom', status: 500 }),
      ],
      { ...noFilter, errorsOnly: true },
    );
    expect(rows.map((row) => row.url)).toEqual(['/boom']);
  });

  it('같은 요청을 다시 하면 엔진별 최신 상태로 덮어쓴다', () => {
    const rows = groupNetworkRows(
      [
        entry({ engine: 'chromium', url: '/api/me', status: 500 }),
        entry({ engine: 'chromium', url: '/api/me', status: 200 }),
      ],
      noFilter,
    );
    expect(rows[0].perEngine.chromium?.status).toBe(200);
  });
});

describe('statusTone', () => {
  it('2xx=ok, 3xx=redirect, 4xx/5xx=error', () => {
    expect(statusTone(200)).toBe('ok');
    expect(statusTone(302)).toBe('redirect');
    expect(statusTone(404)).toBe('error');
    expect(statusTone(500)).toBe('error');
  });
});
