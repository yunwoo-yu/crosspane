import { describe, expect, it } from 'vitest';
import { parseCliArguments, resolveTargetUrl } from '../src/args';

describe('resolveTargetUrl', () => {
  it(':3000 형태를 localhost URL로 확장한다', () => {
    expect(resolveTargetUrl(':3000')).toBe('http://localhost:3000');
  });

  it('숫자만 있어도 포트로 취급한다', () => {
    expect(resolveTargetUrl('5173')).toBe('http://localhost:5173');
  });

  it('완전한 URL은 그대로 둔다', () => {
    expect(resolveTargetUrl('https://example.com/path')).toBe('https://example.com/path');
  });
});

describe('parseCliArguments', () => {
  it('타깃만 주면 기본값이 채워진다', () => {
    const options = parseCliArguments([':3000']);
    expect(options).toEqual({
      url: 'http://localhost:3000',
      engines: ['chromium', 'webkit', 'firefox'],
      device: 'iPhone 15',
      port: 7788,
    });
  });

  it('--engines를 파싱한다', () => {
    const options = parseCliArguments([':3000', '--engines', 'chromium,webkit']);
    expect(options.engines).toEqual(['chromium', 'webkit']);
  });

  it('알 수 없는 엔진이면 던진다', () => {
    expect(() => parseCliArguments([':3000', '--engines', 'chrome'])).toThrow(
      /Unknown engine "chrome"/,
    );
  });

  it('--device / --port / --inject를 반영한다', () => {
    const options = parseCliArguments([
      ':3000',
      '--device',
      'Pixel 7',
      '--port',
      '9000',
      '--inject',
      './bridge.js',
    ]);
    expect(options.device).toBe('Pixel 7');
    expect(options.port).toBe(9000);
    expect(options.injectScriptPath).toBe('./bridge.js');
  });

  it('숫자 옵션에 잘못된 값이 오면 던진다', () => {
    expect(() => parseCliArguments([':3000', '--port', 'abc'])).toThrow(/Invalid value for --port/);
    expect(() => parseCliArguments([':3000', '--port', '-1'])).toThrow(/Invalid value for --port/);
  });

  it('값이 빠진 플래그면 던진다', () => {
    expect(() => parseCliArguments([':3000', '--device'])).toThrow(/Missing value for --device/);
  });

  it('알 수 없는 플래그면 던진다', () => {
    expect(() => parseCliArguments([':3000', '--wat', 'x'])).toThrow(/Unknown option --wat/);
  });
});
