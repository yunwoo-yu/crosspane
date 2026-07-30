import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configPath, loadOrCreateIngestKey, parseConfig } from '../src/config.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'crosspane-cfg-'));
  process.env.CROSSPANE_CONFIG_DIR = dir;
});

afterEach(() => {
  delete process.env.CROSSPANE_CONFIG_DIR;
  try {
    chmodSync(dir, 0o700);
  } catch {
    // 권한 테스트가 남긴 상태 — 정리만 하면 된다
  }
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
    chmodSync(dir, 0o500); // 읽기·실행만 — 쓰기 불가
    const result = loadOrCreateIngestKey();
    expect(result.key).toMatch(/^[0-9a-f]{16}$/); // 허브는 계속 뜬다
    expect(result.ephemeral).toBe(true);
  });
});
