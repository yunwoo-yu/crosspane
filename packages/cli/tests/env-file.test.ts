import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BLOCK_END,
  BLOCK_START,
  clearEnvFile,
  conflictingNames,
  envVarNames,
  renderEnvFile,
  stripManagedBlock,
  writeEnvFile,
} from '../src/env-file.js';

const URL_A = 'http://192.168.0.10:7788/?t=abc123';
const URL_B = 'http://192.168.0.11:7789/?t=def456';

describe('envVarNames', () => {
  it('프레임워크마다 그 번들러가 노출하는 접두사를 고른다', () => {
    expect(envVarNames({ dependencies: { next: '15.0.0' } })).toEqual([
      'NEXT_PUBLIC_CROSSPANE_URL',
    ]);
    expect(envVarNames({ devDependencies: { vite: '6.0.0' } })).toEqual(['VITE_CROSSPANE_URL']);
    expect(envVarNames({ dependencies: { 'react-scripts': '5.0.0' } })).toEqual([
      'REACT_APP_CROSSPANE_URL',
    ]);
    expect(envVarNames({ devDependencies: { astro: '5.0.0' } })).toEqual(['PUBLIC_CROSSPANE_URL']);
  });

  it('감지 실패 시 전부 적는다 — 빠진 변수는 기능 고장으로 보이고, 남는 변수는 무해하다', () => {
    expect(envVarNames({ dependencies: { lodash: '4' } })).toHaveLength(4);
    expect(envVarNames(null)).toHaveLength(4);
    expect(envVarNames(undefined)).toHaveLength(4);
  });

  it('Next + Vite가 함께 있으면 둘 다 적는다 (모노레포)', () => {
    const names = envVarNames({ dependencies: { next: '15' }, devDependencies: { vite: '6' } });
    expect(names).toContain('NEXT_PUBLIC_CROSSPANE_URL');
    expect(names).toContain('VITE_CROSSPANE_URL');
  });
});

describe('renderEnvFile', () => {
  it('빈 파일에 관리 블록을 만든다', () => {
    const out = renderEnvFile('', ['VITE_CROSSPANE_URL'], URL_A);
    expect(out).toBe(`${BLOCK_START}\nVITE_CROSSPANE_URL=${URL_A}\n${BLOCK_END}\n`);
  });

  it('사용자의 기존 줄을 보존한다 — 남의 파일을 덮어쓰지 않는다', () => {
    const existing = 'DATABASE_URL=postgres://localhost/dev\nAPI_KEY=secret\n';
    const out = renderEnvFile(existing, ['VITE_CROSSPANE_URL'], URL_A);
    expect(out.startsWith(existing)).toBe(true);
    expect(out).toContain(`VITE_CROSSPANE_URL=${URL_A}`);
  });

  it('개행이 없는 마지막 줄과 붙지 않는다', () => {
    const out = renderEnvFile('API_KEY=secret', ['VITE_CROSSPANE_URL'], URL_A);
    expect(out).toContain(`API_KEY=secret\n${BLOCK_START}`);
  });

  it('여러 번 실행해도 블록은 하나만 남는다 (허브를 재시작하는 명령이다)', () => {
    let out = renderEnvFile('KEEP=1\n', ['VITE_CROSSPANE_URL'], URL_A);
    out = renderEnvFile(out, ['VITE_CROSSPANE_URL'], URL_B);
    out = renderEnvFile(out, ['VITE_CROSSPANE_URL'], URL_B);
    // 마커에 정규식 메타문자(괄호)가 있어 split으로 센다
    expect(out.split(BLOCK_START)).toHaveLength(2);
    expect(out).toContain(`VITE_CROSSPANE_URL=${URL_B}`);
    expect(out).not.toContain(URL_A);
    expect(out).toContain('KEEP=1');
  });

  it('반복 실행이 개행을 쌓지 않는다', () => {
    let out = renderEnvFile('KEEP=1\n', ['VITE_CROSSPANE_URL'], URL_A);
    for (let i = 0; i < 5; i += 1) out = renderEnvFile(out, ['VITE_CROSSPANE_URL'], URL_A);
    expect(out).not.toMatch(/\n\n\n/);
  });

  it('변수 여러 개를 한 블록에 적는다', () => {
    const out = renderEnvFile('', ['VITE_CROSSPANE_URL', 'NEXT_PUBLIC_CROSSPANE_URL'], URL_A);
    expect(out).toContain(`VITE_CROSSPANE_URL=${URL_A}`);
    expect(out).toContain(`NEXT_PUBLIC_CROSSPANE_URL=${URL_A}`);
  });
});

describe('stripManagedBlock', () => {
  it('블록이 없으면 그대로 둔다', () => {
    expect(stripManagedBlock('A=1\nB=2\n')).toBe('A=1\nB=2\n');
  });

  it('블록만 지우고 앞뒤를 남긴다', () => {
    const withBlock = renderEnvFile('BEFORE=1\n', ['VITE_CROSSPANE_URL'], URL_A);
    expect(stripManagedBlock(`${withBlock}AFTER=2\n`)).toBe('BEFORE=1\nAFTER=2\n');
  });

  it('끝 마커가 잘려 나간 파일도 복구한다 — 강제 종료로 남을 수 있다', () => {
    const truncated = `KEEP=1\n${BLOCK_START}\nVITE_CROSSPANE_URL=${URL_A}\n`;
    expect(stripManagedBlock(truncated)).toBe('KEEP=1\n');
  });
});

describe('conflictingNames', () => {
  it('관리 블록 밖의 중복 정의를 찾아낸다', () => {
    const existing = `VITE_CROSSPANE_URL=http://manual:7788\n`;
    expect(conflictingNames(existing, ['VITE_CROSSPANE_URL'])).toEqual(['VITE_CROSSPANE_URL']);
  });

  it('우리 블록 안의 정의는 충돌이 아니다', () => {
    const ours = renderEnvFile('', ['VITE_CROSSPANE_URL'], URL_A);
    expect(conflictingNames(ours, ['VITE_CROSSPANE_URL'])).toEqual([]);
  });

  it('접두사가 겹치는 다른 변수에 오탐하지 않는다', () => {
    expect(conflictingNames('VITE_CROSSPANE_URL_EXTRA=x\n', ['VITE_CROSSPANE_URL'])).toEqual([]);
  });
});

describe('writeEnvFile / clearEnvFile', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'crosspane-env-'));
    file = join(dir, '.env.local');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('파일이 없으면 만든다', () => {
    const result = writeEnvFile(file, URL_A);
    expect(readFileSync(file, 'utf-8')).toContain(URL_A);
    expect(result.names.length).toBeGreaterThan(0);
  });

  it('옆 package.json으로 변수 이름을 고른다', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { next: '15' } }));
    expect(writeEnvFile(file, URL_A).names).toEqual(['NEXT_PUBLIC_CROSSPANE_URL']);
  });

  it('깨진 package.json으로 죽지 않는다 — 허브 기동을 막으면 안 된다', () => {
    writeFileSync(join(dir, 'package.json'), '{ not json');
    expect(() => writeEnvFile(file, URL_A)).not.toThrow();
  });

  it('종료 시 우리 블록만 지우고 사용자 내용은 남긴다', () => {
    writeFileSync(file, 'DATABASE_URL=postgres://localhost/dev\n');
    writeEnvFile(file, URL_A);
    clearEnvFile(file);
    expect(readFileSync(file, 'utf-8')).toBe('DATABASE_URL=postgres://localhost/dev\n');
  });

  it('우리가 만든 파일이었다면 종료 시 파일 자체를 지운다', () => {
    writeEnvFile(file, URL_A);
    clearEnvFile(file);
    expect(() => readFileSync(file, 'utf-8')).toThrow();
  });

  it('죽은 주소를 남기지 않는다 — 남으면 다음 실행의 루프백 기본값을 덮어쓴다', () => {
    writeEnvFile(file, URL_A);
    clearEnvFile(file);
    // 파일이 없거나, 있어도 우리 변수는 없어야 한다
    let contents = '';
    try {
      contents = readFileSync(file, 'utf-8');
    } catch {
      contents = '';
    }
    expect(contents).not.toContain('CROSSPANE_URL');
  });

  it('없는 파일을 지우려 해도 던지지 않는다', () => {
    expect(() => clearEnvFile(file)).not.toThrow();
  });
});
