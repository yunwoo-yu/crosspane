import { describe, expect, it } from 'vitest';
import { cliVersion, DEFAULT_ENV_FILE, parseCliArguments, parseMcpArguments } from '../src/args';

describe('parseCliArguments', () => {
  it('기본값: 포트 7788, 로컬 전용 바인딩, 브라우저 자동 열기', () => {
    expect(parseCliArguments([])).toEqual({
      port: 7788,
      portExplicit: false,
      host: '127.0.0.1', // 세션 데이터 채널이므로 기본 비노출
      openBrowser: true,
      verbose: false,
      noAuth: false, // 노출 시에만 토큰이 붙고, 그걸 끄는 건 명시적 옵트아웃이다
      writeEnv: undefined, // 사용자 파일을 건드리는 일은 옵트인이어야 한다
      tlsCert: undefined,
      tlsKey: undefined,
      publicUrl: undefined,
      ingestKey: undefined, // 옵트인 — 기본은 주소만으로 보낼 수 있다
      tunnel: false, // 제3자를 거치는 일은 명시적 옵트인이어야 한다
    });
  });

  it('--write-env는 값 없이도 되고 기본 파일은 .env.local이다', () => {
    expect(parseCliArguments(['--write-env']).writeEnv).toBe(DEFAULT_ENV_FILE);
    expect(parseCliArguments(['--write-env', 'apps/web/.env.local']).writeEnv).toBe(
      'apps/web/.env.local',
    );
  });

  it('--write-env가 뒤따르는 플래그를 파일명으로 삼지 않는다', () => {
    // 이걸 놓치면 '0.0.0.0'이 파일명이 되고 허브는 로컬에만 뜬다 — 조용히 어긋난다
    const options = parseCliArguments(['--write-env', '--host', '0.0.0.0']);
    expect(options.writeEnv).toBe(DEFAULT_ENV_FILE);
    expect(options.host).toBe('0.0.0.0');
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

  it('--tls-cert/--tls-key/--public-url을 반영한다', () => {
    const options = parseCliArguments([
      '--tls-cert',
      'cert.pem',
      '--tls-key',
      'key.pem',
      '--public-url',
      'https://abc.trycloudflare.com',
    ]);
    expect(options).toMatchObject({
      tlsCert: 'cert.pem',
      tlsKey: 'key.pem',
      publicUrl: 'https://abc.trycloudflare.com',
    });
  });

  it('TLS는 인증서와 키를 함께 요구한다 — 한쪽만 주고 평문으로 뜨면 진단이 불가능하다', () => {
    expect(() => parseCliArguments(['--tls-cert', 'cert.pem'])).toThrow(/together/);
    expect(() => parseCliArguments(['--tls-key', 'key.pem'])).toThrow(/together/);
  });

  it('--public-url은 http(s)만 받는다 — 에이전트가 이 값으로 WS 주소를 만든다', () => {
    expect(() => parseCliArguments(['--public-url', 'wss://a.example'])).toThrow(/must be http/);
    expect(() => parseCliArguments(['--public-url', 'not a url'])).toThrow(/Invalid value/);
  });

  it('--tunnel은 플래그다 (값 없음)', () => {
    expect(parseCliArguments(['--tunnel']).tunnel).toBe(true);
    expect(parseCliArguments([]).tunnel).toBe(false);
  });

  it('--ingest-key로 키를 고정할 수 있다 — 배포된 앱의 주소가 계속 유효해야 한다', () => {
    expect(parseCliArguments(['--ingest-key', 'team-fixed-key']).ingestKey).toBe('team-fixed-key');
  });

  it('환경변수를 기본값으로 삼되 플래그가 이긴다 — 고정 셋업을 매번 타이핑하지 않는다', () => {
    process.env.CROSSPANE_PUBLIC_URL = 'https://crosspane.example.com';
    process.env.CROSSPANE_INGEST_KEY = 'from-env';
    try {
      expect(parseCliArguments([])).toMatchObject({
        publicUrl: 'https://crosspane.example.com',
        ingestKey: 'from-env',
      });
      expect(parseCliArguments(['--ingest-key', 'from-flag']).ingestKey).toBe('from-flag');
    } finally {
      delete process.env.CROSSPANE_PUBLIC_URL;
      delete process.env.CROSSPANE_INGEST_KEY;
    }
  });

  it('빈 환경변수는 미설정으로 본다 — 정의만 하고 비운 경우가 흔하다', () => {
    process.env.CROSSPANE_PUBLIC_URL = '';
    try {
      expect(parseCliArguments([]).publicUrl).toBeUndefined();
    } finally {
      delete process.env.CROSSPANE_PUBLIC_URL;
    }
  });

  it('환경변수의 잘못된 주소도 기동 전에 잡는다', () => {
    process.env.CROSSPANE_PUBLIC_URL = 'not a url';
    try {
      expect(() => parseCliArguments([])).toThrow(/Invalid value/);
    } finally {
      delete process.env.CROSSPANE_PUBLIC_URL;
    }
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

  it('--hub는 쿼리(접속 토큰)를 남긴다 — 버리면 401로 조용히 실패한다', () => {
    expect(parseMcpArguments(['--hub', 'http://10.0.0.5:9000/?t=abc']).hubUrl).toBe(
      'http://10.0.0.5:9000?t=abc',
    );
    // 끝 슬래시만 있으면 경로가 없는 것으로 본다
    expect(parseMcpArguments(['--hub', 'http://10.0.0.5:9000/']).hubUrl).toBe(
      'http://10.0.0.5:9000',
    );
  });

  it('--hub의 경로 접두사는 유지한다 — 프록시·터널 뒤의 허브에 붙을 수 있어야 한다', () => {
    expect(parseMcpArguments(['--hub', 'https://x.example/__crosspane']).hubUrl).toBe(
      'https://x.example/__crosspane',
    );
    expect(parseMcpArguments(['--hub', 'https://x.example/__crosspane/?t=abc']).hubUrl).toBe(
      'https://x.example/__crosspane?t=abc',
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
