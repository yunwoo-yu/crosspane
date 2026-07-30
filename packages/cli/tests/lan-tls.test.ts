import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  certExpiry,
  dnsBlockedMessage,
  ensureLanTls,
  isUsable,
  lanTlsHostname,
  resolvesToSelf,
} from '../src/lan-tls.js';

/** 실제 발급 인증서를 픽스처로 쓴다 — 만료 파싱은 진짜 X.509로 검증해야 의미가 있다 */
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('lanTlsHostname', () => {
  it('점을 대시로 바꾼다 — 와일드카드는 한 레이블만 덮는다', () => {
    // *.local-ip.sh는 1.2.3.4.local-ip.sh를 덮지 못한다. 이걸 틀리면 인증서가 안 맞는다
    expect(lanTlsHostname('192.168.0.10')).toBe('192-168-0-10.local-ip.sh');
    expect(lanTlsHostname('10.0.0.1')).toBe('10-0-0-1.local-ip.sh');
    expect(lanTlsHostname('172.30.1.29').split('.')).toHaveLength(3);
  });
});

describe('isUsable', () => {
  const pem = (validTo: string) => `-- fake -- ${validTo}`;

  it('읽을 수 없는 PEM은 쓰지 않는다 — 만료 판단이 안 되면 신뢰할 수 없다', () => {
    expect(certExpiry(pem('x'))).toBeUndefined();
    expect(isUsable(pem('x'), new Date())).toBe(false);
  });
});

describe('dnsBlockedMessage', () => {
  it('원인과 대안을 함께 준다 — 막다른 길로 두지 않는다', () => {
    const message = dnsBlockedMessage('192-168-0-10.local-ip.sh', '192.168.0.10');
    expect(message).toContain('192-168-0-10.local-ip.sh');
    expect(message).toContain('rebinding'); // 원인
    expect(message).toContain('--tls-cert'); // 대안 1
    expect(message).toContain('--tunnel'); // 대안 2
  });
});

describe('ensureLanTls', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'crosspane-lan-'));
    process.env.CROSSPANE_CONFIG_DIR = dir;
  });
  afterEach(() => {
    delete process.env.CROSSPANE_CONFIG_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  const realCert = readFileSync(join(FIXTURES, 'cert.pem'), 'utf-8');
  const realKey = readFileSync(join(FIXTURES, 'key.pem'), 'utf-8');
  const fetcher = (calls: string[]) => async (url: string) => {
    calls.push(url);
    return url.endsWith('.key') ? realKey : realCert;
  };

  it('처음에는 받아서 캐시한다', async () => {
    const calls: string[] = [];
    const result = await ensureLanTls('192.168.0.10', new Date('2026-08-01'), fetcher(calls));
    expect(result.hostname).toBe('192-168-0-10.local-ip.sh');
    expect(result.fetched).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('두 번째부터는 캐시를 쓴다 — 매 기동마다 남의 서버를 두드리지 않는다', async () => {
    const calls: string[] = [];
    await ensureLanTls('192.168.0.10', new Date('2026-08-01'), fetcher(calls));
    const second = await ensureLanTls('192.168.0.10', new Date('2026-08-02'), fetcher(calls));
    expect(second.fetched).toBe(false);
    expect(calls).toHaveLength(2); // 늘지 않았다
  });

  it('만료가 임박하면 캐시를 믿지 않고 다시 받는다', async () => {
    const calls: string[] = [];
    await ensureLanTls('192.168.0.10', new Date('2026-08-01'), fetcher(calls));
    // 픽스처 만료(9/18)의 1주 이내로 시계를 옮긴다 → 캐시를 쓰지 않고 재요청해야 한다.
    // 재요청분도 같은(곧 만료될) 인증서라 거부되는 것이 옳다 — 만료된 것으로 뜨면
    // https 페이지에서 조용히 안 붙고 원인을 알 수 없다
    await expect(
      ensureLanTls('192.168.0.10', new Date('2026-09-15'), fetcher(calls)),
    ).rejects.toThrow(/expired|unreadable/);
    expect(calls).toHaveLength(4); // 캐시로 끝내지 않고 실제로 다시 받았다
  });

  it('받아온 것이 만료됐으면 그 사실을 알리고 실패한다', async () => {
    await expect(
      ensureLanTls('192.168.0.10', new Date('2027-01-01'), async () => realCert),
    ).rejects.toThrow(/expired|unreadable/);
  });
});

describe('resolvesToSelf', () => {
  it('해석되지 않는 이름은 false — 여기서 걸러야 사용자가 원인 없는 실패를 안 만난다', async () => {
    expect(await resolvesToSelf('crosspane-nope.invalid', '1.2.3.4')).toBe(false);
  });
});
