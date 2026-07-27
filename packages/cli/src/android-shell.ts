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
 * Android 셸 APK 빌더 — iOS 셸과 동일 철학: Chrome 브라우저가 아니라
 * 앱에 임베드된 WebView 컴포넌트 그 자체를 재현한다 (브라우저 UI 없음, wv UA).
 * SDK build-tools(aapt2/d8/apksigner)로 소스에서 직접 빌드하고 해시로 캐시한다.
 */

function shellSourceDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../shell-android');
}

function latestVersionDir(parent: string): string | undefined {
  if (!existsSync(parent)) return undefined;
  const latest = readdirSync(parent)
    .filter((name) => !name.startsWith('.'))
    .sort()
    .at(-1);
  return latest ? join(parent, latest) : undefined;
}

export async function ensureAndroidShellApk(sdkDir: string): Promise<string> {
  const sourceDir = shellSourceDir();
  const javaSrc = join(sourceDir, 'MainActivity.java');
  const manifest = join(sourceDir, 'AndroidManifest.xml');
  const hash = createHash('sha256')
    .update(await readFile(javaSrc))
    .update(await readFile(manifest))
    .digest('hex')
    .slice(0, 12);
  const outDir = join(homedir(), '.crosspane', 'android-shell', hash);
  const apkPath = join(outDir, 'shell.apk');
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

  // 1) javac → 2) d8(dex) → 3) aapt2 link(빈 리소스 APK) → 4) dex 삽입 → 5) 정렬 → 6) 서명
  await execFileAsync('javac', [
    '--release',
    '17',
    '-nowarn',
    '-cp',
    androidJar,
    '-d',
    join(outDir, 'classes'),
    javaSrc,
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
  await execFileAsync(join(buildTools, 'aapt2'), [
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
  ]);
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
