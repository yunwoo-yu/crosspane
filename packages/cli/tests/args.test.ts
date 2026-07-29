import { describe, expect, it } from 'vitest';
import { cliVersion, parseCliArguments, parseMcpArguments } from '../src/args';

describe('parseCliArguments', () => {
  it('기본값: 포트 7788, 로컬 전용 바인딩, 브라우저 자동 열기', () => {
    expect(parseCliArguments([])).toEqual({
      port: 7788,
      portExplicit: false,
      host: '127.0.0.1', // 세션 데이터 채널이므로 기본 비노출
      openBrowser: true,
      verbose: false,
      noAuth: false, // 노출 시에만 토큰이 붙고, 그걸 끄는 건 명시적 옵트아웃이다
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

describe('parseMcpArguments', () => {
  it('기본 허브는 로컬 7788', () => {
    expect(parseMcpArguments([])).toEqual({ hubUrl: 'http://127.0.0.1:7788', verbose: false });
  });

  it('--hub는 origin으로 정규화하되 쿼리는 남긴다 (접속 토큰)', () => {
    // 경로는 버린다 — 허브 엔드포인트는 우리가 정한다
    expect(parseMcpArguments(['--hub', 'http://10.0.0.5:9000/x']).hubUrl).toBe(
      'http://10.0.0.5:9000',
    );
    // 쿼리는 남긴다 — 노출된 허브는 토큰 없이 붙을 수 없다(버리면 401로 조용히 실패)
    expect(parseMcpArguments(['--hub', 'http://10.0.0.5:9000/?t=abc']).hubUrl).toBe(
      'http://10.0.0.5:9000?t=abc',
    );
  });

  it('--no-auth는 mcp 서브커맨드의 옵션이 아니다', () => {
    expect(() => parseMcpArguments(['--no-auth'])).toThrow(/Unknown option/);
  });

  it('--hub에 포트만 줘도 받는다', () => {
    expect(parseMcpArguments(['--hub', '9000']).hubUrl).toBe('http://127.0.0.1:9000');
  });

  it('--verbose를 반영한다 (진단 출력은 stderr로만 간다)', () => {
    expect(parseMcpArguments(['--verbose']).verbose).toBe(true);
  });

  it('알 수 없는 옵션과 잘못된 URL은 명확한 에러', () => {
    expect(() => parseMcpArguments(['--port', '1'])).toThrow(/Unknown option/);
    expect(() => parseMcpArguments(['--hub'])).toThrow(/Missing value/);
    expect(() => parseMcpArguments(['--hub', 'not a url'])).toThrow(/Invalid value/);
  });
});
