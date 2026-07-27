import { describe, expect, it } from 'vitest';
import { normalizeTarget, parseArgs } from '../src/args';

describe('normalizeTarget', () => {
  it(':3000 형태를 localhost URL로 확장한다', () => {
    expect(normalizeTarget(':3000')).toBe('http://localhost:3000');
  });

  it('숫자만 있어도 포트로 취급한다', () => {
    expect(normalizeTarget('5173')).toBe('http://localhost:5173');
  });

  it('완전한 URL은 그대로 둔다', () => {
    expect(normalizeTarget('https://example.com/path')).toBe('https://example.com/path');
  });
});

describe('parseArgs', () => {
  it('타깃만 주면 기본값이 채워진다', () => {
    const opts = parseArgs([':3000']);
    expect(opts).toEqual({
      url: 'http://localhost:3000',
      engines: ['chromium', 'webkit', 'firefox'],
      device: 'iPhone 15',
      port: 7788,
      fps: 4,
    });
  });

  it('--engines를 파싱한다', () => {
    const opts = parseArgs([':3000', '--engines', 'chromium,webkit']);
    expect(opts.engines).toEqual(['chromium', 'webkit']);
  });

  it('알 수 없는 엔진이면 던진다', () => {
    expect(() => parseArgs([':3000', '--engines', 'chrome'])).toThrow(/Unknown engine "chrome"/);
  });

  it('--device / --port / --fps / --inject를 반영한다', () => {
    const opts = parseArgs([
      ':3000',
      '--device',
      'Pixel 7',
      '--port',
      '9000',
      '--fps',
      '8',
      '--inject',
      './bridge.js',
    ]);
    expect(opts.device).toBe('Pixel 7');
    expect(opts.port).toBe(9000);
    expect(opts.fps).toBe(8);
    expect(opts.injectScriptPath).toBe('./bridge.js');
  });

  it('숫자 옵션에 잘못된 값이 오면 던진다', () => {
    expect(() => parseArgs([':3000', '--port', 'abc'])).toThrow(/Invalid value for --port/);
    expect(() => parseArgs([':3000', '--fps', '-1'])).toThrow(/Invalid value for --fps/);
  });

  it('값이 빠진 플래그면 던진다', () => {
    expect(() => parseArgs([':3000', '--device'])).toThrow(/Missing value for --device/);
  });

  it('알 수 없는 플래그면 던진다', () => {
    expect(() => parseArgs([':3000', '--wat', 'x'])).toThrow(/Unknown option --wat/);
  });
});
