import { describe, expect, it } from 'vitest';
import { cliVersion, parseCliArguments } from '../src/args';

describe('parseCliArguments', () => {
  it('기본값: 포트 7788, 로컬 전용 바인딩, 브라우저 자동 열기', () => {
    expect(parseCliArguments([])).toEqual({
      port: 7788,
      portExplicit: false,
      host: '127.0.0.1', // 세션 데이터 채널이므로 기본 비노출
      openBrowser: true,
      verbose: false,
    });
  });

  it('--port는 명시 플래그로 기록된다 (자동 폴백 없음)', () => {
    const options = parseCliArguments(['--port', '9000']);
    expect(options.port).toBe(9000);
    expect(options.portExplicit).toBe(true);
  });

  it('--host / --no-open / --verbose를 반영한다', () => {
    const options = parseCliArguments(['--host', '0.0.0.0', '--no-open', '--verbose']);
    expect(options).toMatchObject({ host: '0.0.0.0', openBrowser: false, verbose: true });
  });

  it('알 수 없는 옵션과 잘못된 포트는 명확한 에러', () => {
    expect(() => parseCliArguments(['--wat'])).toThrow(/Unknown option/);
    expect(() => parseCliArguments(['--port', 'abc'])).toThrow(/Invalid value/);
  });

  it('cliVersion은 package.json의 semver를 읽는다', () => {
    expect(cliVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
