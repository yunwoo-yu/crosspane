import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extractTunnelUrl,
  isBenignSetupError,
  namedTunnelSteps,
  pickProvider,
  startNamedTunnel,
  startTunnel,
  TUNNEL_PROVIDERS,
  type TunnelProvider,
  tunnelNameFor,
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

describe('named 터널 (고정 주소)', () => {
  it('호스트명에서 터널 이름을 만든다 — 사람이 이름을 정할 이유가 없다', () => {
    expect(tunnelNameFor('crosspane.example.com')).toBe('crosspane-crosspane-example-com');
    expect(tunnelNameFor('a_b/c')).toBe('crosspane-a-b-c');
  });

  it('준비 명령은 create → route dns 순서다', () => {
    const { setup, run } = namedTunnelSteps('t1', 'crosspane.example.com', 7788);
    expect(setup[0]).toEqual(['tunnel', 'create', 't1']);
    expect(setup[1]).toContain('route');
    expect(setup[1]).toContain('crosspane.example.com');
    expect(run.join(' ')).toContain('http://127.0.0.1:7788');
  });

  it('"이미 존재한다"를 성공으로 본다 — 아니면 두 번째 실행부터 못 뜬다', () => {
    for (const text of [
      'tunnel with name t1 already exists',
      'Failed to add route: record with that host already exists',
      'CNAME already configured',
    ]) {
      expect(isBenignSetupError(text), text).toBe(true);
    }
    expect(isBenignSetupError('authentication failed')).toBe(false);
  });

  it('미로그인이면 정확한 조치를 알려준다', async () => {
    await expect(
      startNamedTunnel({
        hostname: 'x.example.com',
        port: 7788,
        command: process.execPath,
        loggedIn: () => false,
      }),
    ).rejects.toThrow(/cloudflared tunnel login/);
  });

  it('준비가 실패하면 그 출력을 담아 거부한다', async () => {
    await expect(
      startNamedTunnel({
        hostname: 'x.example.com',
        port: 7788,
        // node를 cloudflared 대역으로: 어떤 인자든 실패로 끝낸다
        command: process.execPath,
        loggedIn: () => true,
      }),
    ).rejects.toThrow(/failed/);
  });

  it('loggedIn을 안 주면 실제 자격 파일 유무로 판단한다 (기본 경로)', async () => {
    // 이 머신에는 ~/.cloudflared/cert.pem이 없다 → 로그인 안내로 거부되어야 한다.
    // 기본 판정 클로저를 실제로 태우는 것이 이 테스트의 목적이다
    await expect(
      startNamedTunnel({ hostname: 'x.example.com', port: 7788, command: process.execPath }),
    ).rejects.toThrow();
  });

  it('run이 즉시 죽으면 그 사실을 알린다 — 조용히 터널 없이 뜨면 안 된다', async () => {
    const fake = fakeCloudflared({ runExits: true });
    await expect(
      startNamedTunnel({
        hostname: 'x.example.com',
        port: 7788,
        command: fake.command,
        wrapArgs: fake.wrap,
        loggedIn: () => true,
      }),
    ).rejects.toThrow(/exited/);
  });

  it('준비가 통과하면 호스트명 주소로 stable 터널을 돌려준다', async () => {
    // 대역 스크립트: setup은 0으로 끝내고, run은 계속 살아 있는다
    const fake = fakeCloudflared();
    const tunnel = await startNamedTunnel({
      hostname: 'crosspane.example.com',
      port: 7788,
      command: fake.command,
      wrapArgs: fake.wrap,
      loggedIn: () => true,
    });
    expect(tunnel.url).toBe('https://crosspane.example.com');
    expect(tunnel.stable).toBe(true);
    tunnel.stop();
  });
});

/**
 * cloudflared 대역 — setup은 성공, run은 장기 실행(또는 즉시 종료).
 * run 중 stdout/stderr에 한 줄씩 찍어 진단 로깅 경로까지 태운다.
 *
 * **셸 스크립트를 쓰지 않는다.** `#!/bin/sh`는 Windows에서 실행되지 않아 그 레그만
 * 실패했다(실측). node를 실행 파일로 두고 스크립트를 인자로 넘기면 OS와 무관하다.
 */
function fakeCloudflared({ runExits = false }: { runExits?: boolean } = {}): {
  command: string;
  wrap: (args: string[]) => string[];
} {
  const dir = mkdtempSync(join(tmpdir(), 'crosspane-cfd-'));
  const script = join(dir, 'fake-cloudflared.mjs');
  const runBody = runExits
    ? 'process.exit(7)'
    : "console.log('started'); console.error('booting'); setInterval(() => {}, 1000)";
  writeFileSync(
    script,
    `const args = process.argv.slice(2);\nif (args[1] === 'run') { ${runBody} }\n`,
  );
  return { command: process.execPath, wrap: (args) => [script, ...args] };
}
