import { afterEach, describe, expect, it } from 'vitest';
import {
  ACTIVATION_STORAGE_KEY,
  DEFAULT_HUB_PORT,
  envServerUrl,
  isDebugActivated,
  isLoopbackHost,
  isRealPage,
  resolveActivation,
  resolveLiveEndpoint,
} from '../src/endpoint.js';

const JSDOM_UA = 'Mozilla/5.0 (darwin) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/26.1.0';
const BROWSER_UA =
  'Mozilla/5.0 (Linux; Android 13; SM-S901N wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36';

afterEach(() => {
  localStorage.clear();
});

describe('isLoopbackHost', () => {
  it('개발 머신의 호스트명을 알아본다', () => {
    for (const hostname of ['localhost', '127.0.0.1', '::1', '[::1]', 'app.localhost']) {
      expect(isLoopbackHost(hostname), hostname).toBe(true);
    }
  });

  it('배포 호스트는 루프백이 아니다', () => {
    for (const hostname of ['example.com', 'staging.example.com', '192.168.0.10', '10.0.0.4']) {
      expect(isLoopbackHost(hostname), hostname).toBe(false);
    }
  });

  it('localhost를 흉내낸 도메인에 속지 않는다 — 이 판정이 보안 경계다', () => {
    // `notlocalhost`는 endsWith('.localhost')를 통과하지 않아야 한다
    expect(isLoopbackHost('notlocalhost')).toBe(false);
    expect(isLoopbackHost('localhost.attacker.example')).toBe(false);
    expect(isLoopbackHost('127.0.0.1.attacker.example')).toBe(false);
  });
});

describe('resolveLiveEndpoint', () => {
  it('localhost에서는 인자 없이 기본 허브로 붙는다 — 무설정 로컬 개발', () => {
    expect(resolveLiveEndpoint({ hostname: 'localhost', activated: true })).toBe(
      `http://localhost:${DEFAULT_HUB_PORT}`,
    );
  });

  it('페이지의 호스트명을 유지한다 — localhost와 127.0.0.1을 섞지 않는다', () => {
    expect(resolveLiveEndpoint({ hostname: '127.0.0.1', activated: true })).toBe(
      `http://127.0.0.1:${DEFAULT_HUB_PORT}`,
    );
  });

  it('배포 페이지는 주입값이 있어도 활성화 없이는 전송하지 않는다', () => {
    expect(
      resolveLiveEndpoint({
        env: 'http://192.168.0.10:7788/?t=abc',
        hostname: 'staging.example.com',
        activated: false,
      }),
    ).toBeUndefined();
  });

  it('배포 페이지에서 활성화되면 주입된 주소로 붙는다', () => {
    expect(
      resolveLiveEndpoint({
        env: 'http://192.168.0.10:7788/?t=abc',
        hostname: 'staging.example.com',
        activated: true,
      }),
    ).toBe('http://192.168.0.10:7788/?t=abc');
  });

  it('활성화됐지만 주소가 없으면 오프라인이다 — 활성화는 목적지를 만들지 못한다', () => {
    expect(
      resolveLiveEndpoint({ hostname: 'staging.example.com', activated: true }),
    ).toBeUndefined();
  });

  it('프로덕션에 실려 나가도 아무 연결도 시도하지 않는다 (핵심 회귀)', () => {
    // 주입값도 없고 활성화도 없는 실사용자 = 압도적 다수의 경우
    expect(resolveLiveEndpoint({ hostname: 'example.com', activated: false })).toBeUndefined();
  });

  it('명시한 주소는 활성화 없이도 항상 이긴다 — 이미 배포된 사용자를 끊지 않는다', () => {
    expect(
      resolveLiveEndpoint({
        explicit: 'http://192.168.0.10:7788',
        env: 'http://other:7788',
        hostname: 'staging.example.com',
        activated: false,
      }),
    ).toBe('http://192.168.0.10:7788');
  });

  it('루프백에서도 주입값이 기본 포트를 이긴다 — 폴백 포트로 뜬 허브를 가리킬 수 있다', () => {
    expect(
      resolveLiveEndpoint({ env: 'http://localhost:7789', hostname: 'localhost', activated: true }),
    ).toBe('http://localhost:7789');
  });

  it("문자열 'undefined'/'null'을 주소로 쓰지 않는다 — 조용히 영구 실패한다", () => {
    // `serverUrl: \`${process.env.X}\`` 처럼 감싸면 이 값이 온다. 통과시키면 전송이
    // undefined/agent로 붙으려 하고(URL 파싱 실패 → 문자열 폴백) 아무 진단도 남지 않는다
    for (const bogus of ['undefined', 'null']) {
      expect(
        resolveLiveEndpoint({ explicit: bogus, hostname: 'staging.example.com', activated: true }),
        bogus,
      ).toBeUndefined();
      expect(
        resolveLiveEndpoint({ env: bogus, hostname: 'staging.example.com', activated: true }),
        bogus,
      ).toBeUndefined();
    }
    // 루프백이면 잘못된 값 대신 기본값으로 떨어진다 — 여기서는 실제로 붙을 수 있다
    expect(
      resolveLiveEndpoint({ explicit: 'undefined', hostname: 'localhost', activated: true }),
    ).toBe(`http://localhost:${DEFAULT_HUB_PORT}`);
  });

  it('빈 문자열은 미설정으로 본다 — 주입되지 않은 env가 빈 값으로 치환된다', () => {
    expect(
      resolveLiveEndpoint({ explicit: '', env: '', hostname: 'localhost', activated: true }),
    ).toBe(`http://localhost:${DEFAULT_HUB_PORT}`);
    expect(
      resolveLiveEndpoint({ env: '', hostname: 'staging.example.com', activated: true }),
    ).toBeUndefined();
  });
});

describe('resolveActivation', () => {
  it('루프백은 링크 없이 켜져 있다 — 무설정 로컬 개발이 여기 서 있다', () => {
    expect(resolveActivation('', 'localhost')).toBe(true);
  });

  it('루프백에서도 파라미터를 저장한다 (실사용 프로젝트에서 발견한 버그)', () => {
    // 예전에는 루프백에서 즉시 true를 돌려주고 파라미터를 읽지도 저장하지도 않았다.
    // 그래서 `enabled`를 저장값으로 게이팅하는 앱은 링크로 켠 뒤 페이지를 옮기는 순간 꺼졌다
    expect(resolveActivation('?__crosspane=on', 'localhost')).toBe(true);
    expect(localStorage.getItem(ACTIVATION_STORAGE_KEY)).toBe('on');
  });

  it('루프백에서도 off가 먹는다 — 명시한 것을 조용히 무시하지 않는다', () => {
    expect(resolveActivation('?__crosspane=off', 'localhost')).toBe(false);
    expect(localStorage.getItem(ACTIVATION_STORAGE_KEY)).toBe('off');
    // 저장된 off 상태가 루프백 기본값보다 우선한다
    expect(resolveActivation('', 'localhost')).toBe(false);
  });

  it('루프백에서 off면 자동 연결도 끊긴다 — 판정과 전송이 어긋나면 안 된다', () => {
    const activated = resolveActivation('?__crosspane=off', 'localhost');
    expect(resolveLiveEndpoint({ hostname: 'localhost', activated })).toBeUndefined();
    expect(
      resolveLiveEndpoint({ env: 'http://localhost:7789', hostname: 'localhost', activated }),
    ).toBeUndefined();
  });

  it('저장된 활성화는 배포 호스트에서 루프백 판정 없이도 유지된다', () => {
    resolveActivation('?__crosspane=on', 'staging.example.com');
    expect(resolveActivation('', 'staging.example.com')).toBe(true);
  });

  it('배포 페이지는 기본이 꺼짐이다', () => {
    expect(resolveActivation('', 'staging.example.com')).toBe(false);
  });

  it('활성화 링크로 켜고, 그 상태가 다음 페이지로 이어진다', () => {
    expect(resolveActivation('?__crosspane=on', 'staging.example.com')).toBe(true);
    // QA가 페이지를 옮겨다녀도 유지되어야 한다 (링크는 한 번만 받는다)
    expect(resolveActivation('', 'staging.example.com')).toBe(true);
  });

  it('off는 껐다는 사실까지 저장한다 — 지우기만 하면 기본값이 되살아난다', () => {
    resolveActivation('?__crosspane=on', 'staging.example.com');
    expect(resolveActivation('?__crosspane=off', 'staging.example.com')).toBe(false);
    expect(localStorage.getItem(ACTIVATION_STORAGE_KEY)).toBe('off');
    expect(resolveActivation('', 'staging.example.com')).toBe(false);
  });

  it('값 없는 ?__crosspane도 켜는 것으로 본다 — 손으로 타이핑하는 링크다', () => {
    expect(resolveActivation('?__crosspane', 'staging.example.com')).toBe(true);
  });

  it('다른 쿼리에 섞여 있어도 찾아낸다', () => {
    expect(resolveActivation('?utm=x&__crosspane=on&page=2', 'staging.example.com')).toBe(true);
  });

  it('허브 주소를 링크로 받지 않는다 — 로그 탈취 통로가 되기 때문이다', () => {
    // 목적지처럼 보이는 값은 활성화로도 인정하지 않는다
    expect(resolveActivation('?__crosspane=https://attacker.example', 'staging.example.com')).toBe(
      false,
    );
    // resolveLiveEndpoint는 env/explicit만 보므로 이 값이 목적지가 될 경로가 없다
    expect(
      resolveLiveEndpoint({ hostname: 'staging.example.com', activated: true }),
    ).toBeUndefined();
  });

  it('localStorage가 던지는 환경(프라이빗 모드 웹뷰)에서도 페이지를 망가뜨리지 않는다', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('access denied');
      },
    });
    try {
      expect(() => resolveActivation('', 'staging.example.com')).not.toThrow();
      expect(resolveActivation('', 'staging.example.com')).toBe(false);
      // 링크로 켠 이번 로드의 판정은 저장 실패와 무관하게 유지된다
      expect(resolveActivation('?__crosspane=on', 'staging.example.com')).toBe(true);
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original);
    }
  });
});

describe('isDebugActivated', () => {
  it('현재 페이지 기준으로 판정한다 — 앱이 enabled에 그대로 넘기는 함수다', () => {
    // jsdom의 location은 localhost다 → 표시가 없으면 켜진 것으로 본다
    expect(isDebugActivated()).toBe(true);
  });

  it('저장된 off를 존중한다 — enabled 게이팅이 즉시 반영되어야 한다', () => {
    resolveActivation('?__crosspane=off', 'localhost');
    expect(isDebugActivated()).toBe(false);
  });
});

describe('isRealPage', () => {
  it('jsdom은 실제 페이지가 아니다 — 사용자 유닛 테스트에서 연결을 시도하지 않는다', () => {
    expect(isRealPage(JSDOM_UA)).toBe(false);
  });

  it('실제 브라우저·웹뷰는 통과한다', () => {
    expect(isRealPage(BROWSER_UA)).toBe(true);
    expect(isRealPage('Mozilla/5.0 ... HeadlessChrome/120.0.0.0 ...')).toBe(true);
  });
});

describe('resolveLiveEndpoint — 테스트 환경 가드', () => {
  it('jsdom에서는 루프백 자동 연결을 하지 않는다 (실측된 함정)', () => {
    // jsdom은 hostname이 localhost이고 WebSocket도 구현한다 — 가드가 없으면
    // initCrosspane()을 호출하는 앱의 모든 유닛 테스트가 허브를 두드린다
    expect(
      resolveLiveEndpoint({ hostname: 'localhost', activated: true, userAgent: JSDOM_UA }),
    ).toBeUndefined();
  });

  it('jsdom에서는 주입된 주소도 자동으로 쓰지 않는다', () => {
    expect(
      resolveLiveEndpoint({
        env: 'http://192.168.0.10:7788',
        hostname: 'localhost',
        activated: true,
        userAgent: JSDOM_UA,
      }),
    ).toBeUndefined();
  });

  it('jsdom이라도 명시한 주소는 붙는다 — 전송 계층을 테스트할 경로가 필요하다', () => {
    expect(
      resolveLiveEndpoint({
        explicit: 'http://127.0.0.1:9999',
        hostname: 'localhost',
        activated: true,
        userAgent: JSDOM_UA,
      }),
    ).toBe('http://127.0.0.1:9999');
  });

  it('실제 웹뷰에서는 자동 연결이 그대로 동작한다', () => {
    expect(
      resolveLiveEndpoint({ hostname: 'localhost', activated: true, userAgent: BROWSER_UA }),
    ).toBe(`http://localhost:${DEFAULT_HUB_PORT}`);
  });
});

describe('envServerUrl', () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_CROSSPANE_URL;
    delete process.env.REACT_APP_CROSSPANE_URL;
  });

  it('주입된 값을 실제로 읽는다 (실브라우저에서 잡힌 버그의 회귀)', () => {
    // 원래 구현은 `typeof process !== 'undefined'` 가드를 앞에 뒀다. 번들러가 값을
    // 치환해 넣어도 브라우저에는 process 객체가 없어서, **주입이 성공한 환경에서만**
    // 값을 못 읽고 배포 페이지가 조용히 오프라인이 됐다. 가드를 되살리지 말 것
    process.env.NEXT_PUBLIC_CROSSPANE_URL = 'http://192.168.0.10:7788/?t=abc';
    expect(envServerUrl()).toBe('http://192.168.0.10:7788/?t=abc');
  });

  it('CRA 접두사도 읽는다', () => {
    process.env.REACT_APP_CROSSPANE_URL = 'http://192.168.0.11:7788';
    expect(envServerUrl()).toBe('http://192.168.0.11:7788');
  });

  it('빈 문자열 주입은 미설정으로 본다 — 치환되지 않은 변수가 이렇게 도착한다', () => {
    process.env.NEXT_PUBLIC_CROSSPANE_URL = '';
    expect(envServerUrl()).toBeUndefined();
  });

  it('주입이 없는 환경에서 던지지 않고 undefined를 준다', () => {
    // 이 테스트의 값은 결과가 아니라 **던지지 않는다는 사실**이다 —
    // 번들러가 치환하지 않은 process/import.meta 접근이 사용자 페이지를 죽이는 것을 막는다
    expect(() => envServerUrl()).not.toThrow();
    expect(envServerUrl()).toBeUndefined();
  });
});
