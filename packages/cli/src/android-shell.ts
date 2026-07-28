import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Android APK 빌더 — SDK build-tools(aapt2/d8/apksigner)로 소스에서 직접 빌드하고
 * 소스 해시로 캐시한다. 두 APK을 만든다:
 * - 셸(shell-android/): 앱에 임베드된 WebView 컴포넌트 그 자체 (브라우저 UI 없음, wv UA)
 * - IME(ime-android/): 비ASCII(한글) 입력용 무화면 키보드 — adb `input text`의 ASCII 한계 우회
 */

function packageSourceDir(name: string): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', name);
}

function latestVersionDir(parent: string): string | undefined {
  if (!existsSync(parent)) return undefined;
  const latest = readdirSync(parent)
    .filter((name) => !name.startsWith('.'))
    .sort()
    .at(-1);
  return latest ? join(parent, latest) : undefined;
}

interface ApkBuildSpec {
  /** packages/cli 기준 소스 디렉터리 이름 (예: 'shell-android') */
  sourceDirName: string;
  javaFiles: string[];
  /** ~/.crosspane 아래 캐시 디렉터리 이름 */
  cacheName: string;
  /** res/ 디렉터리를 aapt2 compile로 포함할지 (IME의 method.xml 등) */
  hasResources?: boolean;
}

async function buildApk(sdkDir: string, spec: ApkBuildSpec): Promise<string> {
  const sourceDir = packageSourceDir(spec.sourceDirName);
  const manifest = join(sourceDir, 'AndroidManifest.xml');
  const hasher = createHash('sha256').update(await readFile(manifest));
  for (const file of spec.javaFiles) hasher.update(await readFile(join(sourceDir, file)));
  if (spec.hasResources) {
    hasher.update(await readFile(join(sourceDir, 'res', 'xml', 'method.xml')));
  }
  const hash = hasher.digest('hex').slice(0, 12);
  const outDir = join(homedir(), '.crosspane', spec.cacheName, hash);
  const apkPath = join(outDir, `${spec.cacheName}.apk`);
  if (existsSync(apkPath)) return apkPath;

  const buildTools = latestVersionDir(join(sdkDir, 'build-tools'));
  const platform = latestVersionDir(join(sdkDir, 'platforms'));
  if (!buildTools || !platform) {
    throw new Error(
      'Android shell requires SDK build-tools & platforms (sdkmanager "build-tools;35.0.0" "platforms;android-35")',
    );
  }
  const androidJar = join(platform, 'android.jar');
  await mkdir(join(outDir, 'classes'), { recursive: true });

  // 1) javac → 2) d8(dex) → 3) (res 있으면 aapt2 compile) → 4) aapt2 link →
  // 5) dex 삽입 → 6) 정렬 → 7) 서명
  await execFileAsync('javac', [
    '--release',
    '17',
    '-nowarn',
    '-cp',
    androidJar,
    '-d',
    join(outDir, 'classes'),
    ...spec.javaFiles.map((file) => join(sourceDir, file)),
  ]);
  await execFileAsync(join(buildTools, 'd8'), [
    '--release',
    '--lib',
    androidJar,
    '--output',
    outDir,
    ...(await execFileAsync('find', [join(outDir, 'classes'), '-name', '*.class'])).stdout
      .trim()
      .split('\n'),
  ]);
  const linkArgs = [
    'link',
    '--manifest',
    manifest,
    '-I',
    androidJar,
    '--min-sdk-version',
    '26',
    '--target-sdk-version',
    '34',
    '-o',
    join(outDir, 'base.apk'),
  ];
  if (spec.hasResources) {
    await execFileAsync(join(buildTools, 'aapt2'), [
      'compile',
      '--dir',
      join(sourceDir, 'res'),
      '-o',
      join(outDir, 'res.zip'),
    ]);
    linkArgs.push(join(outDir, 'res.zip'));
  }
  await execFileAsync(join(buildTools, 'aapt2'), linkArgs);
  await execFileAsync('zip', ['-qj', join(outDir, 'base.apk'), join(outDir, 'classes.dex')], {
    cwd: outDir,
  });
  await execFileAsync(join(buildTools, 'zipalign'), [
    '-f',
    '4',
    join(outDir, 'base.apk'),
    join(outDir, 'aligned.apk'),
  ]);
  const keystore = join(homedir(), '.crosspane', 'android-shell', 'debug.keystore');
  if (!existsSync(keystore)) {
    await mkdir(dirname(keystore), { recursive: true });
    await execFileAsync('keytool', [
      '-genkeypair',
      '-keystore',
      keystore,
      '-storepass',
      'crosspane',
      '-keypass',
      'crosspane',
      '-alias',
      'crosspane',
      '-keyalg',
      'RSA',
      '-keysize',
      '2048',
      '-validity',
      '10000',
      '-dname',
      'CN=crosspane',
    ]);
  }
  await execFileAsync(join(buildTools, 'apksigner'), [
    'sign',
    '--ks',
    keystore,
    '--ks-pass',
    'pass:crosspane',
    '--out',
    apkPath,
    join(outDir, 'aligned.apk'),
  ]);
  return apkPath;
}

export async function ensureAndroidShellApk(sdkDir: string): Promise<string> {
  return buildApk(sdkDir, {
    sourceDirName: 'shell-android',
    javaFiles: ['MainActivity.java'],
    cacheName: 'android-shell',
  });
}

/** IME 식별자 — `ime enable/set`과 브로드캐스트 대상 */
export const IME_ID = 'dev.crosspane.ime/.CrosspaneIme';
export const IME_BROADCAST_ACTION = 'dev.crosspane.ime.INPUT';

export async function ensureAndroidImeApk(sdkDir: string): Promise<string> {
  return buildApk(sdkDir, {
    sourceDirName: 'ime-android',
    javaFiles: ['CrosspaneIme.java'],
    cacheName: 'android-ime',
    hasResources: true,
  });
}
