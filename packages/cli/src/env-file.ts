/**
 * `--write-env` — 허브가 자기 주소를 앱의 env 파일에 적어 준다.
 *
 * 왜 허브가 쓰는가: LAN IP도 접속 토큰도 **허브만 알고 있고, 재시작마다 바뀐다**.
 * 그걸 사람이 대시보드에서 읽어 코드로 옮겨 적는 것이 이 툴의 가장 큰 마찰이었다.
 * 옮겨 적을 이유가 없다 — 아는 쪽이 쓰면 된다.
 *
 * 프레임워크별 플러그인을 만들지 않는 이유: env 파일은 Vite·Next·CRA·Astro가
 * 모두 이미 읽는다. 플러그인 하나당 유지보수가 붙는데, 얻는 것이 같다.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

/** 관리 블록 경계 — 이 사이만 우리가 소유한다. 밖의 내용은 절대 건드리지 않는다 */
export const BLOCK_START = '# crosspane:start (auto-generated — removed when the hub stops)';
export const BLOCK_END = '# crosspane:end';

/** 에이전트가 읽는 변수 이름들 (`packages/agent/src/endpoint.ts`의 envServerUrl과 일치해야 한다) */
const ALL_NAMES = [
  'VITE_CROSSPANE_URL',
  'NEXT_PUBLIC_CROSSPANE_URL',
  'PUBLIC_CROSSPANE_URL',
  'REACT_APP_CROSSPANE_URL',
] as const;

/**
 * 프로젝트에 맞는 변수 이름. 번들러는 자기 접두사만 클라이언트에 노출하므로
 * 틀린 이름을 쓰면 **조용히 undefined가 된다** — 감지 실패 시에는 전부 적는다.
 * 남는 변수는 해가 없지만, 빠진 변수는 기능이 안 되는 것으로 보인다.
 */
export function envVarNames(packageJson: unknown): string[] {
  const pkg = packageJson as
    | { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
    | null
    | undefined;
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  const names: string[] = [];
  if ('next' in deps) names.push('NEXT_PUBLIC_CROSSPANE_URL');
  if ('vite' in deps) names.push('VITE_CROSSPANE_URL');
  if ('react-scripts' in deps) names.push('REACT_APP_CROSSPANE_URL');
  if ('astro' in deps || '@sveltejs/kit' in deps) names.push('PUBLIC_CROSSPANE_URL');
  return names.length > 0 ? names : [...ALL_NAMES];
}

/** 관리 블록을 제거한 내용 — 우리 것만 지우고 사용자의 나머지 줄은 그대로 남긴다 */
export function stripManagedBlock(contents: string): string {
  const start = contents.indexOf(BLOCK_START);
  if (start === -1) return contents;
  const endMarker = contents.indexOf(BLOCK_END, start);
  const end = endMarker === -1 ? contents.length : endMarker + BLOCK_END.length;
  const before = contents.slice(0, start);
  const after = contents.slice(end);
  // 블록 앞뒤로 개행이 쌓이지 않게 정리한다 (반복 실행되는 명령이다)
  return `${before.replace(/\n+$/, '\n')}${after.replace(/^\n+/, '')}`;
}

/** 기존 내용 + 새 관리 블록. 같은 파일에 여러 번 실행해도 블록은 하나만 남는다 */
export function renderEnvFile(existing: string, names: string[], url: string): string {
  const base = stripManagedBlock(existing);
  const prefix = base === '' || base.endsWith('\n') ? base : `${base}\n`;
  const lines = names.map((name) => `${name}=${url}`).join('\n');
  return `${prefix}${BLOCK_START}\n${lines}\n${BLOCK_END}\n`;
}

/**
 * 관리 블록 **밖에** 같은 변수가 이미 정의돼 있는지.
 *
 * 경고해야 하는 이유: 한 파일에 같은 키가 두 번 있으면 어느 쪽이 이기는지는 로더마다
 * 다르다. 조용히 두 줄을 남기면 "주소를 넣었는데 엉뚱한 곳에 붙는" 디버깅 불가능한
 * 상태가 된다 — 우리가 덮어쓰지 않고 사람에게 알린다.
 */
export function conflictingNames(existing: string, names: string[]): string[] {
  const outside = stripManagedBlock(existing);
  return names.filter((name) =>
    outside.split('\n').some((line) => line.trimStart().startsWith(`${name}=`)),
  );
}

export interface WriteEnvResult {
  path: string;
  names: string[];
  /** 관리 블록 밖의 중복 정의 — 있으면 사람이 손으로 지워야 한다 */
  conflicts: string[];
  /**
   * git이 무시하는 파일인지. false면 **토큰이 커밋될 수 있다** —
   * undefined는 판정 불가(git 저장소가 아님)로, 경고하지 않는다
   */
  gitignored: boolean | undefined;
}

/** 허브 주소를 env 파일의 관리 블록에 쓴다. 파일의 나머지 내용은 보존한다 */
export function writeEnvFile(filePath: string, url: string): WriteEnvResult {
  const absolute = resolve(filePath);
  const existing = existsSync(absolute) ? readFileSync(absolute, 'utf-8') : '';
  const names = envVarNames(readPackageJson(dirname(absolute)));
  writeFileSync(absolute, renderEnvFile(existing, names, url), 'utf-8');
  return {
    path: absolute,
    names,
    conflicts: conflictingNames(existing, names),
    gitignored: isGitIgnored(absolute),
  };
}

/**
 * 관리 블록을 지운다 — 허브가 멈추면 그 주소와 토큰은 더 이상 유효하지 않다.
 *
 * 남겨 두면 다음 실행에서 **죽은 주소가 루프백 기본값을 덮어써** 에이전트가 조용히
 * 아무데도 붙지 않는다. 되돌리기 어려운 실패 모드라 종료 경로에서 반드시 정리한다.
 * 블록만 지웠는데 파일이 비면 파일 자체를 삭제한다(우리가 만든 파일이었다).
 */
export function clearEnvFile(filePath: string): void {
  const absolute = resolve(filePath);
  if (!existsSync(absolute)) return;
  const remaining = stripManagedBlock(readFileSync(absolute, 'utf-8'));
  if (remaining.trim() === '') rmSync(absolute, { force: true });
  else writeFileSync(absolute, remaining, 'utf-8');
}

function readPackageJson(startDir: string): unknown {
  // env 파일이 있는 곳에서 위로 올라가며 찾는다 (모노레포의 앱 디렉터리를 지원)
  let dir = startDir;
  for (let depth = 0; depth < 5; depth += 1) {
    const candidate = resolve(dir, 'package.json');
    if (existsSync(candidate)) {
      try {
        return JSON.parse(readFileSync(candidate, 'utf-8'));
      } catch {
        return null; // 깨진 package.json 때문에 허브 기동을 막지 않는다
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** git이 이 파일을 무시하는지. 저장소가 아니거나 git이 없으면 undefined(판정 불가) */
function isGitIgnored(absolute: string): boolean | undefined {
  try {
    execFileSync('git', ['check-ignore', '-q', basename(absolute)], {
      cwd: dirname(absolute),
      stdio: 'ignore',
    });
    return true;
  } catch (err) {
    // exit 1 = 무시되지 않음(판정됨), 그 밖(128 등) = 저장소가 아님 → 판정 불가
    const code = (err as { status?: number }).status;
    return code === 1 ? false : undefined;
  }
}
