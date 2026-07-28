import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * ScreenCaptureKit 헬퍼 빌더 — 시뮬레이터 "창"을 30fps 무결점 JPEG 스트림으로 캡처한다.
 * 시뮬 내부 API 없이(공개 API) 고fps를 얻는 유일한 경로. 창 노출 + 화면기록 권한 1회 필요.
 */
export async function ensureSckHelper(): Promise<string> {
  const source = resolve(dirname(fileURLToPath(import.meta.url)), '../shell-sck/main.swift');
  const hash = createHash('sha256')
    .update(await readFile(source))
    .digest('hex')
    .slice(0, 12);
  const outDir = join(homedir(), '.crosspane', 'sck', hash);
  const binPath = join(outDir, 'sck-helper');
  if (existsSync(binPath)) return binPath;
  await mkdir(outDir, { recursive: true });
  await execFileAsync('swiftc', [source, '-o', binPath], { timeout: 120_000 });
  return binPath;
}
