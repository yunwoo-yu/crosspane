import { emitKeypressEvents } from 'node:readline';
import * as readline from 'node:readline/promises';
import type { ProfileName } from './args.js';

export interface MissingSetup {
  target: boolean;
  profile: boolean;
  port: boolean;
}

export interface InteractiveAnswers {
  target?: string;
  profile?: ProfileName;
  port?: number;
}

/** argv에서 인터랙티브로 물어봐야 할 항목을 찾는다 (명시된 플래그는 묻지 않는다) */
export function detectMissingSetup(argv: string[]): MissingSetup {
  const hasTarget = argv.length > 0 && !argv[0].startsWith('-');
  return {
    target: !hasTarget,
    profile: !argv.includes('--profile'),
    port: !argv.includes('--port'),
  };
}

/** 인터랙티브 답변을 argv에 합친다 — 이후 일반 플래그 파싱을 그대로 재사용하기 위함 */
export function applyInteractiveAnswers(argv: string[], answers: InteractiveAnswers): string[] {
  let merged = [...argv];
  if (answers.target !== undefined) merged = [answers.target, ...merged];
  if (answers.profile !== undefined) merged = [...merged, '--profile', answers.profile];
  if (answers.port !== undefined) merged = [...merged, '--port', String(answers.port)];
  return merged;
}

interface SelectChoice<T> {
  label: string;
  hint: string;
  value: T;
}

const PROFILE_CHOICES: SelectChoice<ProfileName>[] = [
  {
    label: 'webview',
    hint: 'Chromium + WebKit — in-app webview QA (fast, recommended)',
    value: 'webview',
  },
  { label: 'web', hint: '+ Firefox — mobile web cross-browsing', value: 'web' },
  { label: 'device', hint: 'webview + REAL Android emulator / iOS Simulator', value: 'device' },
  { label: 'full', hint: 'everything', value: 'full' },
];

const DEFAULT_PORT = 7788;

/** 빠진 항목만 순서대로 묻는다: 대상 URL → 프로필(화살표 선택) → 포트 */
export async function runInteractiveSetup(missing: MissingSetup): Promise<InteractiveAnswers> {
  const answers: InteractiveAnswers = {};
  if (missing.target) {
    answers.target = await promptText('Dev server to preview (e.g. :3000 or a URL)', undefined, {
      validate: (value) => value.length > 0 || 'target is required',
    });
  }
  if (missing.profile) {
    answers.profile = await promptSelect('Which setup do you want to run?', PROFILE_CHOICES);
  }
  if (missing.port) {
    const raw = await promptText('Dashboard port', String(DEFAULT_PORT), {
      validate: (value) =>
        (Number.isInteger(Number(value)) && Number(value) > 0) || 'enter a positive number',
    });
    answers.port = Number(raw);
  }
  return answers;
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
