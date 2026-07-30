import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  configPath,
  loadConfig,
  loadOrCreateIngestKey,
  parseConfig,
  saveConfigValue,
} from '../src/config.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'crosspane-cfg-'));
  process.env.CROSSPANE_CONFIG_DIR = dir;
});

afterEach(() => {
  delete process.env.CROSSPANE_CONFIG_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe('parseConfig', () => {
  it('저장된 키를 읽는다', () => {
    expect(parseConfig('{"ingestKey":"abc"}')).toEqual({ ingestKey: 'abc' });
  });

  it('깨진 파일로 기동을 막지 않는다 — 값 없음으로 보고 새로 만든다', () => {
    for (const bad of ['', '{ not json', 'null', '[]', '"text"', '42']) {
      expect(parseConfig(bad), bad).toEqual({});
    }
  });

  it('빈 문자열·잘못된 타입은 미설정으로 본다', () => {
    expect(parseConfig('{"ingestKey":""}')).toEqual({});
    expect(parseConfig('{"ingestKey":123}')).toEqual({});
  });
});

describe('publicUrl 저장', () => {
  it('한 번 주면 기억한다 — 매번 타이핑하면 결국 셸 export가 된다', () => {
    expect(saveConfigValue('publicUrl', 'https://crosspane.example.com')).toBe(true);
    expect(loadConfig().publicUrl).toBe('https://crosspane.example.com');
  });

  it('인제스트 키와 한 파일에 공존한다', () => {
    const { key } = loadOrCreateIngestKey();
    saveConfigValue('publicUrl', 'https://crosspane.example.com');
    expect(loadConfig()).toEqual({ ingestKey: key, publicUrl: 'https://crosspane.example.com' });
  });

  it('빈 문자열로 지운 것은 미설정으로 읽힌다', () => {
    saveConfigValue('publicUrl', 'https://crosspane.example.com');
    saveConfigValue('publicUrl', '');
    expect(loadConfig().publicUrl).toBeUndefined();
  });

  it('저장 못 해도 던지지 않고 false를 준다 — 허브 기동을 막지 않는다', () => {
    // 파일 자리를 디렉터리로 막는다. chmod로 쓰기를 막는 방식은 Windows에서 통하지 않아
    // 그 레그만 실패했다(실측) — OS 무관한 방법을 쓴다
    mkdirSync(configPath(), { recursive: true });
    expect(saveConfigValue('publicUrl', 'https://x.example')).toBe(false);
  });

  it('설정 파일이 없으면 빈 객체다', () => {
    expect(loadConfig()).toEqual({});
  });

  it('경로에 읽을 수 없는 것이 있어도 던지지 않는다 — 허브가 죽으면 안 된다', () => {
    mkdirSync(configPath(), { recursive: true }); // 파일 자리에 디렉터리
    expect(() => loadConfig()).not.toThrow();
    expect(loadConfig()).toEqual({});
  });
});

describe('loadOrCreateIngestKey', () => {
  it('없으면 만들어 저장한다 — 사용자가 openssl을 칠 이유가 없다', () => {
    const first = loadOrCreateIngestKey();
    expect(first.created).toBe(true);
    expect(first.ephemeral).toBe(false);
    expect(first.key).toMatch(/^[0-9a-f]{16}$/);
    expect(existsSync(configPath())).toBe(true);
  });

  it('두 번째부터는 같은 키를 돌려준다 (핵심 회귀)', () => {
    // 여기가 무너지면 허브 재시작마다 배포된 앱의 주소가 상한다
    const first = loadOrCreateIngestKey();
    const second = loadOrCreateIngestKey();
    expect(second.key).toBe(first.key);
    expect(second.created).toBe(false);
  });

  it('깨진 설정 파일이 있어도 새 키를 만들어 덮어쓴다', () => {
    writeFileSync(configPath(), '{ broken');
    const result = loadOrCreateIngestKey();
    expect(result.created).toBe(true);
    expect(parseConfig(readFileSync(configPath(), 'utf-8')).ingestKey).toBe(result.key);
  });

  it('파일의 다른 설정을 보존한다 — 나중에 다른 값이 들어올 수 있다', () => {
    writeFileSync(configPath(), JSON.stringify({ somethingElse: 'keep me' }));
    loadOrCreateIngestKey();
    const raw = JSON.parse(readFileSync(configPath(), 'utf-8')) as Record<string, unknown>;
    expect(raw.somethingElse).toBe('keep me');
    expect(typeof raw.ingestKey).toBe('string');
  });

  it('저장 못 하면 ephemeral로 알린다 — 조용히 바뀌면 배포된 앱이 이유 없이 끊긴다', () => {
    // 설정 파일 자리를 디렉터리로 막아 쓰기를 실패시킨다 (chmod는 Windows에서 무효 — 실측)
    mkdirSync(configPath(), { recursive: true });
    const result = loadOrCreateIngestKey();
    expect(result.key).toMatch(/^[0-9a-f]{16}$/); // 허브는 계속 뜬다
    expect(result.ephemeral).toBe(true);
  });
});
