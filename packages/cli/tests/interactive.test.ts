import { describe, expect, it } from 'vitest';
import { findRunningDevServers, hasTargetArgument } from '../src/interactive';

describe('hasTargetArgument', () => {
  it('첫 인자가 타깃이면 true', () => {
    expect(hasTargetArgument([':3000'])).toBe(true);
    expect(hasTargetArgument(['http://localhost:3000', '--fresh'])).toBe(true);
  });

  it('비어 있거나 플래그로 시작하면 false', () => {
    expect(hasTargetArgument([])).toBe(false);
    expect(hasTargetArgument(['--profile', 'web'])).toBe(false);
  });
});

describe('findRunningDevServers', () => {
  it('리스닝 중인 포트만 순서대로 반환한다', async () => {
    const probe = (port: number) => Promise.resolve(port === 3000 || port === 5173);
    await expect(findRunningDevServers([3000, 4000, 5173], probe)).resolves.toEqual([3000, 5173]);
  });

  it('아무것도 안 떠 있으면 빈 배열', async () => {
    await expect(findRunningDevServers([3000], () => Promise.resolve(false))).resolves.toEqual([]);
  });
});
