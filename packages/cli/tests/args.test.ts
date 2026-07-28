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
  it('기본 프로필은 webview — Chromium+WebKit 2-pane, 실기기 pane 꺼짐', () => {
    const options = parseCliArguments([':3000']);
    expect(options).toMatchObject({
      url: 'http://localhost:3000',
      profile: 'webview',
      engines: ['chromium', 'webkit'], // 웹뷰 QA에 Firefox(Gecko)는 대응물이 없다
      autoStartRealDevices: false,
      device: 'iPhone 15',
      port: 7788,
      host: '127.0.0.1', // 원격 제어 채널이므로 기본 로컬 전용
      emulateWebview: true,
      freshSession: false,
    });
  });

  it('--host로 바인드 주소를 바꿀 수 있다', () => {
    expect(parseCliArguments([':3000', '--host', '0.0.0.0']).host).toBe('0.0.0.0');
  });

  it('--profile web은 Firefox를 자동 시작에 추가한다', () => {
    const options = parseCliArguments([':3000', '--profile', 'web']);
    expect(options.engines).toEqual(['chromium', 'webkit', 'firefox']);
    expect(options.autoStartRealDevices).toBe(false);
  });

  it('--profile device는 실기기 자동 시작을 켠다', () => {
    const options = parseCliArguments([':3000', '--profile', 'device']);
    expect(options.engines).toEqual(['chromium', 'webkit']);
    expect(options.autoStartRealDevices).toBe(true);
  });

  it('명시 플래그가 프로필보다 우선한다 (플래그 순서 무관)', () => {
    const options = parseCliArguments([':3000', '--ios-sim', '--profile', 'webview']);
    expect(options.iosSimulator).toBe(true); // webview 프로필이어도 강제 시작
    const options2 = parseCliArguments([':3000', '--profile', 'full', '--no-android']);
    expect(options2.android).toBe(false); // pane 자체를 제외
  });

  it('알 수 없는 프로필이면 던진다', () => {
    expect(() => parseCliArguments([':3000', '--profile', 'nope'])).toThrow(/Unknown profile/);
  });

  it('--no-ios-sim / --android 플래그를 반영한다', () => {
    expect(parseCliArguments([':3000', '--profile', 'device', '--no-ios-sim']).iosSimulator).toBe(
      false,
    );
    expect(parseCliArguments([':3000', '--android']).android).toBe(true);
    // 플래그가 없으면 undefined — pane 표시/시작은 SDK 가용성과 프로필이 결정
    expect(parseCliArguments([':3000']).android).toBeUndefined();
  });

  it('--user-agent와 --preset-ua를 반영한다', () => {
    expect(parseCliArguments([':3000', '--user-agent', 'MyApp/1.0']).customUserAgent).toBe(
      'MyApp/1.0',
    );
    expect(parseCliArguments([':3000', '--preset-ua']).emulateWebview).toBe(false);
    expect(parseCliArguments([':3000', '--fresh']).freshSession).toBe(true);
    expect(parseCliArguments([':3000', '--ios-runtime', '17.2']).iosRuntime).toBe('17.2');
    // 값이 없는 플래그 뒤의 옵션도 정상 파싱된다
    expect(parseCliArguments([':3000', '--preset-ua', '--port', '9000']).port).toBe(9000);
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

describe('--no-open / 포트 명시 여부', () => {
  it('기본은 openBrowser=true, portExplicit=false', () => {
    const options = parseCliArguments([':3000']);
    expect(options.openBrowser).toBe(true);
    expect(options.portExplicit).toBe(false);
  });

  it('--no-open은 브라우저 자동 열기를 끈다', () => {
    expect(parseCliArguments([':3000', '--no-open']).openBrowser).toBe(false);
  });

  it('--port를 주면 portExplicit=true (자동 폴백 비활성)', () => {
    const options = parseCliArguments([':3000', '--port', '9000']);
    expect(options.port).toBe(9000);
    expect(options.portExplicit).toBe(true);
  });
});
