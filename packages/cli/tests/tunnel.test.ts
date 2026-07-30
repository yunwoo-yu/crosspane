import { describe, expect, it } from 'vitest';
import {
  extractTunnelUrl,
  pickProvider,
  startTunnel,
  TUNNEL_PROVIDERS,
  type TunnelProvider,
} from '../src/tunnel.js';

describe('extractTunnelUrl', () => {
  it('cloudflared의 사람용 배너에서 주소를 뽑는다', () => {
    // 실제 출력은 박스 그림 안에 주소가 섞여 나온다
    const line = '|  https://tidy-mango-fox-9f2a.trycloudflare.com                              |';
    expect(extractTunnelUrl(line)).toBe('https://tidy-mango-fox-9f2a.trycloudflare.com');
  });

  it('ngrok의 JSON 로그에서 주소를 뽑는다', () => {
    const line =
      '{"addr":"http://localhost:7788","lvl":"info","msg":"started tunnel","url":"https://8162-1-2-3-4.ngrok-free.app"}';
    expect(extractTunnelUrl(line)).toBe('https://8162-1-2-3-4.ngrok-free.app');
  });

  it('예전 ngrok.io 도메인도 받는다', () => {
    expect(extractTunnelUrl('url=https://abcd1234.ngrok.io ok')).toBe('https://abcd1234.ngrok.io');
  });

  it('주소가 없는 줄에서는 undefined', () => {
    for (const line of ['', 'starting tunnel...', 'http://localhost:7788', 'ERR_NGROK_108']) {
      expect(extractTunnelUrl(line), line).toBeUndefined();
    }
  });

  it('평문 http 주소를 터널 주소로 오인하지 않는다 — wss가 목적이다', () => {
    expect(extractTunnelUrl('http://foo.trycloudflare.com')).toBeUndefined();
  });

  it('남의 도메인을 주워오지 않는다', () => {
    expect(extractTunnelUrl('see https://example.com/docs for help')).toBeUndefined();
  });
});

describe('pickProvider', () => {
  it('설치된 첫 제공자를 고른다 (cloudflared 우선)', () => {
    expect(pickProvider(() => true)?.command).toBe('cloudflared');
    expect(pickProvider((c) => c === 'ngrok')?.command).toBe('ngrok');
  });

  it('아무것도 없으면 undefined — 호출부가 설치 안내를 찍는다', () => {
    expect(pickProvider(() => false)).toBeUndefined();
  });

  it('모든 제공자가 설치 안내를 갖는다 — 없을 때 막다른 길이 되면 안 된다', () => {
    for (const provider of TUNNEL_PROVIDERS) {
      expect(provider.install, provider.command).toBeTruthy();
      expect(provider.args(7788).join(' '), provider.command).toContain('7788');
    }
  });
});

/**
 * `startTunnel`은 실제 프로세스를 띄운다. node를 가짜 제공자로 써서 spawn·파싱·실패
 * 경로를 전부 태운다 — 터널 바이너리를 요구하지 않으므로 CI에서도 돈다.
 */
function fakeProvider(script: string, command = process.execPath): TunnelProvider {
  return {
    command,
    label: 'fake tunnel',
    args: () => ['-e', script],
    install: 'n/a',
  };
}

describe('startTunnel', () => {
  it('stdout에 찍힌 주소로 resolve한다 (ngrok 형태)', async () => {
    const tunnel = await startTunnel(
      fakeProvider('console.log(JSON.stringify({url:"https://a1.ngrok-free.app"}))'),
      7788,
    );
    expect(tunnel.url).toBe('https://a1.ngrok-free.app');
    tunnel.stop();
  });

  it('stderr에 찍힌 주소도 받는다 — cloudflared는 배너를 stderr로 보낸다', async () => {
    const tunnel = await startTunnel(
      fakeProvider('console.error("|  https://b2.trycloudflare.com  |")'),
      7788,
    );
    expect(tunnel.url).toBe('https://b2.trycloudflare.com');
    tunnel.stop();
  });

  it('주소를 못 찍고 종료하면 거부한다 — 조용히 터널 없이 뜨면 안 된다', async () => {
    await expect(
      startTunnel(fakeProvider('console.log("starting..."); process.exit(3)'), 7788),
    ).rejects.toThrow(/exited/);
  });

  it('실행 파일이 없으면 원인을 밝히고 거부한다', async () => {
    await expect(
      startTunnel(fakeProvider('', '/nonexistent/crosspane-no-such-binary'), 7788),
    ).rejects.toThrow(/could not run/);
  });

  it('stop()이 자식 프로세스를 정리한다 — 허브가 죽을 때 터널이 남으면 안 된다', async () => {
    // 주소를 찍고 계속 사는 프로세스
    const tunnel = await startTunnel(
      fakeProvider('console.log("https://c3.ngrok-free.app"); setInterval(()=>{}, 1000)'),
      7788,
    );
    expect(() => tunnel.stop()).not.toThrow();
  });
});
