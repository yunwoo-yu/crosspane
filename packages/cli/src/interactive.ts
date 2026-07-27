import * as net from 'node:net';
import { emitKeypressEvents } from 'node:readline';
import * as readline from 'node:readline/promises';

// 프론트엔드 dev 서버가 흔히 쓰는 포트 — 실행 중인 것을 감지해 선택지로 제안한다
export const DEV_SERVER_PROBE_PORTS: readonly number[] = [
  3000, 3001, 4000, 4200, 5000, 5173, 5174, 8000, 8080, 8081,
];

const PROBE_TIMEOUT_MS = 250;

/** localhost 포트에 TCP 연결이 되는지 확인 (HTTP 파싱 없이 리스닝 여부만) */
function probePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const finish = (listening: boolean): void => {
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(PROBE_TIMEOUT_MS, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

/** 실행 중인 dev 서버 포트를 병렬 스캔한다 (probe는 테스트에서 주입 가능) */
export async function findRunningDevServers(
  ports: readonly number[] = DEV_SERVER_PROBE_PORTS,
  probe: (port: number) => Promise<boolean> = probePort,
): Promise<number[]> {
  const results = await Promise.all(ports.map(async (port) => ((await probe(port)) ? port : null)));
  return results.filter((port): port is number => port !== null);
}

/** argv에 대상(URL/포트)이 명시됐는지 — 없을 때만 인터랙티브로 묻는다 */
export function hasTargetArgument(argv: string[]): boolean {
  return argv.length > 0 && !argv[0].startsWith('-');
}

/**
 * 대상만 묻는다 — pane 구성은 대시보드 토글, 포트는 자동 폴백이 대신한다.
 * 실행 중인 dev 서버가 감지되면 선택지로, 없으면 직접 입력으로.
 */
export async function promptForTarget(): Promise<string> {
  const running = await findRunningDevServers();
  if (running.length > 0) {
    const choice = await promptSelect<string | null>('Which dev server do you want to preview?', [
      ...running.map((port) => ({
        label: `:${port}`,
        hint: `http://localhost:${port} (detected)`,
        value: `:${port}` as string | null,
      })),
      { label: 'other', hint: 'enter a URL or port manually', value: null },
    ]);
    if (choice !== null) return choice;
  }
  return promptText('Dev server to preview (e.g. :3000 or a URL)', undefined, {
    validate: (value) => value.length > 0 || 'target is required',
  });
}

interface SelectChoice<T> {
  label: string;
  hint: string;
  value: T;
}

function promptText(
  question: string,
  defaultValue: string | undefined,
  options: { validate: (value: string) => true | string },
): Promise<string> {
  return (async () => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const suffix = defaultValue ? ` (${defaultValue})` : '';
      while (true) {
        const answer = (await rl.question(`? ${question}${suffix}: `)).trim() || defaultValue || '';
        const valid = options.validate(answer);
        if (valid === true) return answer;
        process.stdout.write(`  ${valid}\n`);
      }
    } finally {
      rl.close();
    }
  })();
}

function promptSelect<T>(question: string, choices: SelectChoice<T>[]): Promise<T> {
  return new Promise((resolve) => {
    let index = 0;

    const render = (initial: boolean): void => {
      // 이전 렌더를 지우고 다시 그린다 (질문 1줄 + 선택지 N줄)
      if (!initial) process.stdout.write(`\x1b[${choices.length + 1}A`);
      process.stdout.write(`\x1b[0J? ${question} (↑/↓, Enter)\n`);
      for (const [i, choice] of choices.entries()) {
        const marker = i === index ? '❯' : ' ';
        process.stdout.write(`  ${marker} ${choice.label.padEnd(8)} ${choice.hint}\n`);
      }
    };

    emitKeypressEvents(process.stdin);
    const wasRaw = process.stdin.isRaw === true;
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const finish = (value: T): void => {
      process.stdin.off('keypress', onKeypress);
      process.stdin.setRawMode(wasRaw);
      process.stdin.pause();
      resolve(value);
    };

    const onKeypress = (_chunk: string, key: { name?: string; ctrl?: boolean }): void => {
      if (key.ctrl && key.name === 'c') process.exit(130);
      if (key.name === 'up') {
        index = (index + choices.length - 1) % choices.length;
        render(false);
      } else if (key.name === 'down') {
        index = (index + 1) % choices.length;
        render(false);
      } else if (key.name === 'return') {
        finish(choices[index].value);
      }
    };

    process.stdin.on('keypress', onKeypress);
    render(true);
  });
}
