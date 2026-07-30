/**
 * 허브의 영속 설정 — 지금은 인제스트 키 하나뿐이다.
 *
 * 왜 저장하는가: 인제스트 키는 배포된 앱의 주소에 담긴다. 매 기동마다 새로 만들면
 * **허브를 재시작할 때마다 앱을 다시 배포해야 한다.** 그렇다고 사용자에게 `openssl`로
 * 만들어 환경변수에 넣으라고 하는 것은 라이브러리가 할 일을 사용자에게 미루는 것이다.
 * 처음 한 번 만들어 저장하면 둘 다 해결된다 — 자동 생성이면서 영구히 같은 값이다.
 *
 * **읽기 토큰은 저장하지 않는다.** 그쪽은 세션 로그를 읽을 수 있으므로 기동마다 새로
 * 만드는 것이 안전 장치이고, 앱에 들어가지 않으니 바뀌어도 아무 지장이 없다.
 * 인제스트 키는 쓰기 전용이라 공개를 전제로 설계됐으므로 디스크에 남는 것에 대가가 없다.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** 설정 파일 경로. `CROSSPANE_CONFIG_DIR`로 옮길 수 있다 (테스트·CI용) */
export function configPath(): string {
  const dir = process.env.CROSSPANE_CONFIG_DIR ?? join(homedir(), '.crosspane');
  return join(dir, 'config.json');
}

export interface HubConfig {
  /** 쓰기 전용 인제스트 키 — 공개를 전제로 한 값이다 */
  ingestKey?: string;
  /** 마지막으로 쓴 `--public-url` — 고정 터널 주소를 매번 타이핑하지 않기 위해 기억한다 */
  publicUrl?: string;
}

/** 깨진 파일로 허브 기동을 막지 않는다 — 값이 없는 것으로 보고 새로 만든다 */
export function parseConfig(text: string): HubConfig {
  const raw = parseRawConfig(text);
  const config: HubConfig = {};
  if (typeof raw.ingestKey === 'string' && raw.ingestKey !== '') config.ingestKey = raw.ingestKey;
  if (typeof raw.publicUrl === 'string' && raw.publicUrl !== '') config.publicUrl = raw.publicUrl;
  return config;
}

/**
 * 값을 하나 저장한다 (파일의 다른 필드는 보존). 저장 실패 시 false.
 *
 * `--public-url`을 여기에 기억해 두는 이유: 고정 터널 주소는 한 번 정하면 안 바뀌는데,
 * 매 기동마다 다시 타이핑하게 만들면 결국 셸 프로파일에 export를 넣게 된다 —
 * 사용자가 관리할 값을 늘리는 것이고, 그건 라이브러리가 할 일을 미루는 것이다.
 */
export function saveConfigValue(key: keyof HubConfig, value: string): boolean {
  const path = configPath();
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const existing = existsSync(path) ? parseRawConfig(readFileSync(path, 'utf-8')) : {};
    if (existing[key] === value) return true; // 같은 값이면 파일을 건드리지 않는다
    writeFileSync(path, `${JSON.stringify({ ...existing, [key]: value }, null, 2)}\n`, {
      mode: 0o600,
    });
    return true;
  } catch {
    return false;
  }
}

/** 저장된 설정 (없거나 깨졌으면 빈 객체) */
export function loadConfig(): HubConfig {
  const path = configPath();
  if (!existsSync(path)) return {};
  try {
    return parseConfig(readFileSync(path, 'utf-8'));
  } catch {
    return {};
  }
}

/**
 * 파일의 **모든** 필드를 그대로 돌려준다 (객체가 아니면 빈 객체).
 *
 * 쓸 때 이걸 쓰는 이유: 검증된 필드만 남겨 쓰면 우리가 모르는 설정이 조용히 사라진다.
 * 나중에 이 파일에 값이 추가되거나, 사용자가 손으로 뭔가 적어 뒀을 수 있다 —
 * 남의 파일을 덮어쓰지 않는다는 원칙은 env 파일과 같다(`env-file.ts`).
 */
function parseRawConfig(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export interface IngestKeyResult {
  key: string;
  /** 이번 기동에서 새로 만들었는지 — 사람에게 알릴 때만 쓴다 */
  created: boolean;
  /** 저장에 실패했는지. true면 다음 기동에서 키가 바뀐다 — 반드시 알려야 한다 */
  ephemeral: boolean;
}

/**
 * 저장된 인제스트 키를 읽고, 없으면 만들어 저장한다.
 *
 * 저장 실패로 기동을 막지 않는다 — 허브와 대시보드는 키 없이도 동작한다. 대신
 * `ephemeral`로 알려서, 다음 기동에 값이 바뀐다는 사실을 사용자가 모르고 지나치지 않게 한다
 * (조용히 바뀌면 배포된 앱이 이유 없이 끊긴 것처럼 보인다).
 */
export function loadOrCreateIngestKey(): IngestKeyResult {
  // 읽기 실패도 "저장된 키 없음"으로 본다. 경로에 디렉터리가 있거나 권한이 없으면
  // readFileSync가 던지는데, 그것으로 허브가 죽으면 안 된다(테스트에서 실제로 잡혔다)
  const stored = loadConfig().ingestKey;
  if (stored !== undefined) return { key: stored, created: false, ephemeral: false };
  const path = configPath();

  const key = randomBytes(8).toString('hex');
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    // 모르는 필드까지 보존한다 — 검증된 것만 남겨 쓰면 남의 설정이 조용히 사라진다
    const existing = existsSync(path) ? parseRawConfig(readFileSync(path, 'utf-8')) : {};
    writeFileSync(path, `${JSON.stringify({ ...existing, ingestKey: key }, null, 2)}\n`, {
      mode: 0o600,
    });
    return { key, created: true, ephemeral: false };
  } catch {
    return { key, created: true, ephemeral: true };
  }
}
