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
 * 퀵 터널은 실행마다 주소가 바뀐다. `--write-env`와 함께 쓰면 그 값이 앱의 env 파일에
 * 자동으로 들어가므로 문제가 되지 않는다. 배포된 앱처럼 주소를 사람이 붙여넣는 경우에는
 * 고정 주소(named 터널)를 쓰고 `--public-url`로 알려 주는 편이 맞다.
 */
import { spawn } from 'node:child_process';
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
    install: 'brew install cloudflared  (or https://developers.cloudflare.com/cloudflare-one/)',
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
  stop(): void;
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
      resolve({ url, provider: provider.label, stop: () => child.kill('SIGTERM') });
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
