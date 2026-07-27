import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * 첫 실행 UX: Playwright 브라우저가 없으면 명령어 안내 대신 그 자리에서 설치한다.
 * (npx 사용자는 "npx playwright install"의 실행 컨텍스트가 애매해 안내만으로는 실패하기 쉽다)
 */

export function isMissingBrowserError(err: unknown): boolean {
  return /Executable doesn't exist|browserType\.launch: .*not found/i.test(String(err));
}

/** playwright CLI를 우리 의존성 트리에서 찾아 `install <engine>`을 실행한다 */
export function installPlaywrightBrowser(engine: string): Promise<boolean> {
  const require = createRequire(import.meta.url);
  let cliPath: string;
  try {
    // exports 맵이 cli.js를 노출하지 않으므로 package.json 위치로 실제 경로를 만든다
    cliPath = join(dirname(require.resolve('playwright/package.json')), 'cli.js');
  } catch {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    // stdio inherit — 다운로드 진행률이 그대로 보이게
    const child = spawn(process.execPath, [cliPath, 'install', engine], { stdio: 'inherit' });
    child.on('exit', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}
