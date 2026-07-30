import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectHint } from '../src/components/ConnectHint';
import { render, screen, waitFor } from './render';

/**
 * 이 컴포넌트는 온보딩의 마지막 한 걸음이다 — serverUrl을 잘못 적으면 세션이 아무데도
 * 붙지 않고 대시보드는 이유 없이 비어 보인다. 그래서 **실제 허브 포트**가 스니펫에
 * 들어가는지가 계약이다.
 */

const hubInfo = (info: Record<string, unknown>) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => info })),
  );
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ConnectHint', () => {
  it('허브가 알려준 주소를 붙여넣을 스니펫에 넣는다', async () => {
    hubInfo({ port: 7790, exposed: false, serverUrls: ['http://localhost:7790'] });
    render(<ConnectHint />);

    // 기본 포트가 아니어도(폴백) 화면의 값은 실제 포트여야 한다
    await waitFor(() => expect(screen.getByText(/http:\/\/localhost:7790/)).toBeTruthy());
    expect(screen.getByText(/initCrosspane/)).toBeTruthy();
  });

  it('로컬 전용이면 실기기 접속 방법을 안내한다', async () => {
    hubInfo({ port: 7788, exposed: false, serverUrls: ['http://localhost:7788'] });
    render(<ConnectHint />);

    await waitFor(() => expect(screen.getByText(/Local only/)).toBeTruthy());
    expect(screen.getByText('pnpm try:lan')).toBeTruthy();
  });

  it('노출된 경우 LAN 주소를 쓰고, 여분 주소도 알려준다', async () => {
    hubInfo({
      port: 7788,
      exposed: true,
      serverUrls: ['http://192.168.0.10:7788', 'http://10.0.0.5:7788'],
    });
    render(<ConnectHint />);

    await waitFor(() => expect(screen.getByText(/192\.168\.0\.10:7788/)).toBeTruthy());
    expect(screen.getByText(/Other addresses/)).toBeTruthy();
    expect(screen.queryByText(/Local only/)).toBeNull();
  });

  it('허브가 없으면(리플레이 전용) 아무것도 렌더하지 않는다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    const { container } = render(<ConnectHint />);
    await waitFor(() => expect(container.firstChild).toBeNull());
  });
});
