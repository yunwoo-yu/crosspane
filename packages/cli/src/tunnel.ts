/**
 * `--tunnel` — 설치된 터널 바이너리를 허브가 직접 띄우고 그 주소를 자기 주소로 쓴다.
 *
 * 왜 필요한가: `https://` 페이지에서 라이브로 보려면 허브가 `wss://`로 닿아야 하고, 가장
 * 빠른 길이 터널이다. 그런데 손으로 하면 터미널 두 개 + 주소 복붙이 된다 — 실행할 때마다.
 * 주소를 아는 쪽(터널)과 그 주소를 안내해야 하는 쪽(허브)이 같은 프로세스 트리에 있으면
 * 사람이 옮길 이유가 없다.
 *
 * **바이너리를 내려받지 않는다.** 설치된 것만 쓴다 — 디버깅 도구가 임의의 실행 파일을
 * 받아 실행하는 것은 그 자체로 신뢰 문제다. 없으면 설치 방법을 알려주고 멈춘다.
 *
 * 퀵 터널은 실행마다 주소가 바뀐다. `--write-env`와 함께 쓰면 값이 앱의 env 파일에 자동으로
 * 들어가므로 문제가 없지만, **배포된 앱은 주소가 배포 설정에 들어가므로 고정이어야 한다.**
 * 그래서 `--hostname`으로 named 터널을 지원한다 (`startNamedTunnel`).
 *
 * 고정 주소를 얻는 데 1회 계정 로그인이 필요한 것은 우회할 수 없다 — 공개 호스트명은
 * 어딘가의 계정에 묶여 있다. 실측한 것들: ngrok 무료는 커스텀 서브도메인을 거부한다
 * ("Only paid plans may create endpoints with custom subdomains"), Tailscale Funnel은
 * 도메인 없이 고정 `*.ts.net`을 주지만 tailnet에서 Funnel을 켜야 한다.
 * 다만 **로그인 이후는 전부 비대화형이라 자동화된다** — 그게 아래가 하는 일이다.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { debugLog } from './debug.js';

/** 터널이 주소를 알려 줄 때까지 기다리는 상한 — 넘으면 원인을 밝히고 멈춘다 */
const URL_TIMEOUT_MS = 30_000;

export interface TunnelProvider {
  /** 실행 파일 이름 */
  command: string;
  args(port: number): string[];
  /** 사람이 읽을 이름 */
  label: string;
  /** 설치 안내 */
  install: string;
}

export const TUNNEL_PROVIDERS: TunnelProvider[] = [
  {
    command: 'cloudflared',
    label: 'Cloudflare quick tunnel',
    args: (port) => ['tunnel', '--url', `http://127.0.0.1:${port}`],
    install:
      'brew install cloudflared  (or apt/yum/winget — see Cloudflare docs). ' +
      '`npx cloudflared` works without installing, but that wrapper is community-maintained, ' +
      'not published by Cloudflare.',
  },
  {
    command: 'ngrok',
    label: 'ngrok',
    args: (port) => ['http', String(port), '--log', 'stdout', '--log-format', 'json'],
    install: 'brew install ngrok  (or https://ngrok.com/download)',
  },
];

/**
 * 출력 한 줄에서 터널 주소를 뽑는다.
 *
 * 두 제공자의 형태가 달라서 하나의 정규식으로 본다 — cloudflared는 사람이 읽는 배너에
 * 주소를 섞어 찍고, ngrok은 JSON 안에 담는다. 형태를 가정하지 않고 **주소 자체를** 찾으면
 * 배너 레이아웃이나 JSON 키가 바뀌어도 계속 동작한다.
 */
export function extractTunnelUrl(line: string): string | undefined {
  const match =
    /https:\/\/[a-z0-9][a-z0-9._-]*\.(?:trycloudflare\.com|ngrok[a-z0-9.-]*\.app|ngrok\.io)/i.exec(
      line,
    );
  return match?.[0];
}

export interface Tunnel {
  url: string;
  provider: string;
  /** 재시작해도 같은 주소인지 — 배포된 앱에 쓸 수 있는지를 결정한다 */
  stable: boolean;
  stop(): void;
}

/** cloudflared 로그인 자격 파일 — 없으면 named 터널을 만들 수 없다 */
export const CLOUDFLARED_CERT = '.cloudflared/cert.pem';

/**
 * named 터널 준비 명령들 (실행 순서대로). 마지막이 장기 실행이다.
 *
 * 매번 돌려도 되도록 만들었다 — 이미 있으면 cloudflared가 "already exists"로 끝내고,
 * 그건 `isBenignSetupError`가 성공으로 본다. 그래서 이 함수의 결과가 **매일 쓰는 명령**이
 * 될 수 있다: 사용자는 터널이 처음인지 아닌지 신경 쓰지 않는다.
 */
export function namedTunnelSteps(
  name: string,
  hostname: string,
  port: number,
): { setup: string[][]; run: string[] } {
  return {
    setup: [
      ['tunnel', 'create', name],
      ['tunnel', 'route', 'dns', '--overwrite-dns', name, hostname],
    ],
    run: ['tunnel', 'run', '--url', `http://127.0.0.1:${port}`, name],
  };
}

/**
 * 이미 준비된 상태를 나타내는 실패인지 — 그렇다면 성공으로 본다.
 *
 * cloudflared는 "이미 존재한다"를 0이 아닌 종료 코드로 알린다. 그걸 실패로 다루면
 * 두 번째 실행부터 못 뜨고, 사용자는 첫 실행인지 기억해야 한다.
 */
export function isBenignSetupError(output: string): boolean {
  return /already exists|already configured|record with that host already/i.test(output);
}

/** 호스트명에서 터널 이름을 만든다 — 사람이 이름을 정하게 만들 이유가 없다 */
export function tunnelNameFor(hostname: string): string {
  const cleaned = hostname.replace(/[^a-zA-Z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return `crosspane-${cleaned}`.slice(0, 60);
}

/** 사용 가능한 첫 제공자 (없으면 undefined) */
export function pickProvider(
  available: (command: string) => boolean,
  providers: TunnelProvider[] = TUNNEL_PROVIDERS,
): TunnelProvider | undefined {
  return providers.find((provider) => available(provider.command));
}

/**
 * 터널을 띄우고 주소를 받아 온다. 실패는 던진다 — `--tunnel`을 줬는데 조용히 터널 없이
 * 뜨면 `https://` 페이지에서 왜 안 붙는지 추적할 방법이 없다.
 */
export function startTunnel(provider: TunnelProvider, port: number): Promise<Tunnel> {
  const child = spawn(provider.command, provider.args(port), {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return new Promise<Tunnel>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, url?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error !== undefined || url === undefined) {
        child.kill('SIGTERM');
        reject(error ?? new Error(`${provider.label} did not report a URL`));
        return;
      }
      resolve({ url, provider: provider.label, stable: false, stop: () => child.kill('SIGTERM') });
    };

    const timer = setTimeout(
      () =>
        finish(
          new Error(
            `${provider.label} did not report a URL within ${URL_TIMEOUT_MS / 1000}s — ` +
              `run it by hand to see why, then use --public-url instead`,
          ),
        ),
      URL_TIMEOUT_MS,
    );

    // 두 제공자가 각각 stdout/stderr를 쓰므로 양쪽을 본다
    const onData = (chunk: Buffer): void => {
      for (const line of chunk.toString().split('\n')) {
        debugLog('tunnel', line);
        const url = extractTunnelUrl(line);
        if (url !== undefined) finish(undefined, url);
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);

    child.on('error', (err) =>
      finish(new Error(`could not run ${provider.command}: ${err.message}`)),
    );
    child.on('exit', (code) =>
      finish(
        new Error(`${provider.label} exited (code ${code ?? 'unknown'}) before reporting a URL`),
      ),
    );
  });
}

export interface NamedTunnelOptions {
  hostname: string;
  port: number;
  /** cloudflared 실행 경로 (기본 'cloudflared') — 테스트에서 대역으로 바꾼다 */
  command?: string;
  /** 로그인 자격이 있는지. 기본은 `~/.cloudflared/cert.pem` 존재 여부 */
  loggedIn?: () => boolean;
  /**
   * 인자 변형 (테스트 전용). 대역 실행 파일에 스크립트 경로를 앞에 붙이기 위해 존재한다 —
   * 셸 스크립트를 대역으로 쓰면 Windows에서 실행되지 않는다(실측).
   */
  wrapArgs?: (args: string[]) => string[];
}

/**
 * 고정 주소 named 터널 — 준비(create·route)까지 우리가 하고, 그 다음 run을 띄운다.
 *
 * `--hostname`을 주면 배포된 앱 케이스가 로컬 케이스만큼 단순해진다: 매일 `crosspane`
 * 한 줄이고, 앱의 배포 설정에는 그 호스트명이 영구히 그대로 있다.
 *
 * 로그인만 사람 몫이다(브라우저 OAuth). 그것 없이 진행하면 create가 알 수 없는 오류로
 * 죽으므로, 먼저 확인해서 정확한 조치를 알려 준다.
 */
export async function startNamedTunnel(options: NamedTunnelOptions): Promise<Tunnel> {
  const command = options.command ?? 'cloudflared';
  const loggedIn = options.loggedIn ?? (() => existsSync(join(homedir(), CLOUDFLARED_CERT)));
  if (!loggedIn()) {
    throw new Error(
      'cloudflared is not logged in — run `cloudflared tunnel login` once (it opens a browser),\n' +
        '  then this becomes a single command. A Cloudflare-managed domain is required.',
    );
  }

  const name = tunnelNameFor(options.hostname);
  const wrap = options.wrapArgs ?? ((args: string[]) => args);
  const { setup, run } = namedTunnelSteps(name, options.hostname, options.port);
  for (const args of setup) {
    const result = spawnSync(command, wrap(args), { encoding: 'utf-8' });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    debugLog('tunnel', `${command} ${args.join(' ')} → ${result.status ?? 'error'}`);
    // 이미 준비된 상태는 성공이다 — 아니면 두 번째 실행부터 못 뜬다
    if (result.status !== 0 && !isBenignSetupError(output)) {
      throw new Error(
        `\`${command} ${args.join(' ')}\` failed: ${output.trim() || 'unknown error'}`,
      );
    }
  }

  const child = spawn(command, wrap(run), { stdio: ['ignore', 'pipe', 'pipe'] });
  const url = `https://${options.hostname}`;
  // 주소는 우리가 정했으므로 출력에서 찾을 필요가 없다. 다만 즉시 죽는 경우는 알려야 한다
  await new Promise<void>((resolve, reject) => {
    const settle = setTimeout(resolve, 2_000);
    child.on('error', (err) => {
      clearTimeout(settle);
      reject(new Error(`could not run ${command}: ${err.message}`));
    });
    child.on('exit', (code) => {
      clearTimeout(settle);
      reject(new Error(`${command} tunnel run exited (code ${code ?? 'unknown'})`));
    });
    child.stdout?.on('data', (chunk: Buffer) => debugLog('tunnel', chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => debugLog('tunnel', chunk.toString()));
  });

  return {
    url,
    provider: `Cloudflare named tunnel (${name})`,
    stable: true,
    stop: () => child.kill('SIGTERM'),
  };
}
