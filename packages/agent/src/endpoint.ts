/**
 * 라이브 허브 주소를 **인자 없이** 결정한다 — `initCrosspane({ label })`만으로
 * 로컬 개발이 끝나야 하고, 배포된 페이지에서는 기기별로 켠 사람만 전송해야 한다.
 *
 * 왜 필요한가: `serverUrl`은 원래도 옵셔널이었다. 아팠던 것은 줄 수가 아니라 **그 문자열의
 * 내용**이다 — LAN IP를 찾아 타이핑하고, 허브 재시작마다 바뀌는 토큰을 붙이고, 그게
 * 프로덕션 번들에 섞이지 않게 사람이 신경 쓰는 일. 그 세 가지를 없애는 것이 이 파일의 목적이다.
 *
 * 오프라인 캡처(링버퍼 + `copyCapture()`)는 이 결정과 **무관하게 항상 동작한다**.
 * 여기서 정하는 것은 라이브 전송을 붙일지뿐이다 — 잠금 환경의 주력 경로를
 * 주소 해석 실패로 잃지 않기 위한 분리다.
 */

/** 허브 기본 포트 (`packages/cli/src/args.ts`의 DEFAULT_PORT와 같아야 한다) */
export const DEFAULT_HUB_PORT = 7788;

/** 배포 페이지에서 이 기기의 라이브 전송을 켜는 쿼리 파라미터 */
export const ACTIVATION_PARAM = '__crosspane';
/** 활성화 지속 저장 키 — 페이지를 옮겨다녀도 유지된다 */
export const ACTIVATION_STORAGE_KEY = 'crosspane:live';

/**
 * 이 페이지가 개발자 자신의 기기에서 열린 것인지.
 *
 * 이 판정이 곧 보안 경계다: 루프백에서만 무설정 자동 연결을 허용하므로,
 * 프로덕션에 실려 나간 `initCrosspane()`은 실사용자 브라우저에서 절대 연결을 시도하지 않는다.
 * (`/agent` 채널은 Origin을 검증하지 않는다 — `packages/cli/src/server.ts` 참조.
 * 즉 "주소만 있으면 붙는다"로 만들면 아무 웹사이트나 개발자의 로컬 허브에 가짜 세션을
 * 밀어넣을 수 있다. 그래서 게이트는 주소가 아니라 **페이지가 있는 곳**이어야 한다.)
 */
export function isLoopbackHost(hostname: string): boolean {
  // 앵커(^$)가 이 판정의 전부다 — 없으면 `localhost.attacker.example`이 통과한다.
  // `(.+\.)?localhost`는 서브도메인 개발 셋업을 위한 것이다 (RFC 6761)
  return /^(\[?::1\]?|127\.0\.0\.1|(.+\.)?localhost)$/.test(hostname);
}

/** 주입값이 실제로 설정된 것인지 — 치환되지 않은 env는 빈 문자열로 도착한다 */
function nonEmpty(value: string | undefined): value is string {
  return value !== undefined && value !== '';
}

/**
 * 빌드 시 주입된 허브 주소. `crosspane --write-env`가 써 준 값을 번들러가 치환한다.
 *
 * 실측으로 정해진 형태 — 함부로 리팩터링하면 조용히 undefined가 된다:
 *
 * - **번들러는 자기 형태의 리터럴만 정적 치환한다.** webpack/Next는 `process.env.NEXT_PUBLIC_*`
 *   라는 **문자열이 그대로 나타날 때만** 값으로 바꾼다. `globalThis.process?.env?.X`처럼
 *   우회하면 치환이 일어나지 않는다. 그래서 지역 `declare`로 타입을 맞춘다
 *   (이 패키지는 의도적으로 node 타입 없이 검사한다 — `packages/agent/CLAUDE.md`).
 * - **다른 번들러에서는 그 리터럴이 그대로 남는다.** Vite 빌드에 `process`는 존재하지 않으므로
 *   `typeof` 가드 없이 접근하면 ReferenceError로 사용자 페이지를 망가뜨린다. 가드는 필수다.
 * - **`import.meta`는 `./standalone` 번들에서 `{}`로 붕괴한다** (esbuild + target es2019, 실측).
 *   npm 소비자는 tsc 산출물(`dist/index.js`)을 받으므로 거기서는 살아 있고 Vite가 치환한다.
 *   script 태그로 쓰는 쪽은 주입할 번들러가 애초에 없으므로 undefined가 정답이다.
 */
export function envServerUrl(): string | undefined {
  const meta = readEnv(
    // Vite는 VITE_, Astro/SvelteKit은 PUBLIC_ 접두사를 클라이언트에 노출한다
    () => import.meta.env.VITE_CROSSPANE_URL ?? import.meta.env.PUBLIC_CROSSPANE_URL,
  );
  if (nonEmpty(meta)) return meta;
  const injected = readEnv(
    () => process.env.NEXT_PUBLIC_CROSSPANE_URL ?? process.env.REACT_APP_CROSSPANE_URL,
  );
  // 빈 문자열을 그대로 흘리지 않는다 — 호출부가 또 걸러야 하는 계약은 언젠가 새어 나간다
  return nonEmpty(injected) ? injected : undefined;
}

/**
 * 치환되지 않은 접근은 던지는 것이 정상이다 — 그것이 "이 번들러가 아니다"의 신호다.
 *
 * **`typeof process !== 'undefined'` 같은 가드를 앞에 두지 말 것 (실측된 버그).**
 * 번들러가 값을 치환해 넣어도 `process` 객체 자체는 브라우저에 없을 수 있다.
 * 가드를 두면 정작 주입이 성공한 환경에서 값을 못 읽어 배포 페이지가 조용히 오프라인이 된다.
 * 소스별로 따로 감싸는 이유도 같다 — 한쪽이 던져도 다른 쪽 조회가 살아 있어야 한다
 * (Next에서는 `import.meta.env`가 없어 첫 조회가 TypeError로 죽는다).
 */
function readEnv(read: () => string | undefined): string | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

// 번들러가 `process.env.X` / `import.meta.env.X` **리터럴**을 찾아 치환한다.
// 접근을 우회해 쓰면(globalThis.process 등) 치환이 일어나지 않으므로 타입만 맞춰 준다.
// (이 패키지는 의도적으로 node 타입 없이 검사한다 — `packages/agent/CLAUDE.md`)
declare const process: { env: Record<string, string | undefined> };

declare global {
  interface ImportMeta {
    env: Record<string, string | undefined>;
  }
}

/**
 * 이 기기에서 라이브 전송이 켜져 있는지.
 *
 * 루프백(내 개발 머신)은 항상 켜져 있다. 배포된 페이지는 **기기별 옵트인**이다 —
 * 스테이징·프로덕션은 여러 사람이 보는 곳이므로, 링크를 연 기기만 기록해야 한다.
 *
 * 활성화 링크는 **"켠다"만 담고 "어디로 보낼지"는 담지 않는다.** 목적지를 링크로 받게
 * 만들면 `?__crosspane=https://attacker.example`을 담은 링크 하나로 피해자의 콘솔·토큰이
 * 공격자 서버로 흐른다. 목적지는 빌드/코드에서만 온다 — 이 구분을 무너뜨리지 말 것.
 *
 * 파라미터를 URL에서 지우지 않는다: 사용자 앱의 라우터를 건드리지 않는 것이
 * 더 중요한 불변식이다(`.claude/rules/agent-sdk.md`). 링크가 퍼져도 담긴 정보는
 * "켠다"뿐이므로 최악의 경우가 팀 자신의 허브에 세션이 하나 더 붙는 것이다.
 */
export function isLiveActivated(search: string, hostname: string): boolean {
  if (isLoopbackHost(hostname)) return true;

  const requested = readActivationParam(search);
  if (requested !== undefined) {
    writeStoredActivation(requested);
    return requested;
  }
  return readStoredActivation();
}

/** `?__crosspane=on|off` (값 없는 `?__crosspane`도 on). 없으면 undefined */
function readActivationParam(search: string): boolean | undefined {
  let value: string | null = null;
  try {
    value = new URLSearchParams(search).get(ACTIVATION_PARAM);
  } catch {
    return undefined;
  }
  if (value === null) return undefined;
  if (value === 'off') return false;
  // 값 없이 `?__crosspane`만 붙인 경우도 켜는 것으로 본다 (손으로 타이핑하는 링크다).
  // 그 밖의 값은 켜지 않는다 — 특히 목적지처럼 보이는 값을 활성화로 인정하면 안 된다
  return value === '' || value === 'on';
}

// 스토리지 접근은 항상 던질 수 있다 — 프라이빗 모드 웹뷰, 쿠키 차단, 파일 오리진.
// 저장에 실패해도 이번 페이지의 활성화 판정은 유지되어야 하므로 조용히 넘긴다.
function readStoredActivation(): boolean {
  try {
    return localStorage.getItem(ACTIVATION_STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

function writeStoredActivation(on: boolean): void {
  try {
    if (on) localStorage.setItem(ACTIVATION_STORAGE_KEY, 'on');
    else localStorage.removeItem(ACTIVATION_STORAGE_KEY);
  } catch {
    // 저장 못 해도 이번 로드에는 반영된다 (호출부가 반환값을 쓴다)
  }
}

/**
 * 실제 페이지가 있는 환경인지 — 자동 추론을 발동해도 되는지의 판정.
 *
 * 왜 필요한가 (실측): jsdom은 `location.hostname === 'localhost'`이고 `WebSocket`도 구현한다.
 * 가드가 없으면 `initCrosspane()`을 호출하는 앱의 **모든 유닛 테스트가** 로컬 허브로 연결을
 * 시도해 테스트 출력을 연결 오류로 채운다. 보는 사람도, 디버깅할 화면도 없는 곳이다.
 *
 * 자동 추론에만 적용한다 — 명시한 `serverUrl`은 여기서도 그대로 붙는다(전송 계층 자체를
 * 테스트하는 경로가 필요하다). 헤드리스 브라우저는 막지 않는다: 실제 페이지가 있고,
 * E2E에서 라이브로 보는 것이 오히려 이 툴의 용도다.
 */
export function isRealPage(userAgent: string): boolean {
  return !userAgent.includes('jsdom/');
}

export interface LiveEndpointInput {
  /** `initCrosspane({ serverUrl })` — 사람이 직접 쓴 주소 */
  explicit?: string;
  /** 빌드 시 주입된 주소 (`envServerUrl()`) */
  env?: string;
  /** `location.hostname` */
  hostname: string;
  /** `isLiveActivated()` */
  activated: boolean;
  /** `navigator.userAgent` — 자동 추론을 발동해도 되는 환경인지 판정한다 */
  userAgent?: string;
}

/**
 * 라이브 전송에 쓸 주소. undefined면 오프라인 캡처 전용으로 동작한다.
 *
 * 우선순위: 명시 > 주입 > 루프백 기본값 > 없음.
 *
 * **명시한 주소와 주입된 주소를 다르게 취급한다** — 일관성을 깨는 대신 실사용을 고른 지점이다:
 * - `serverUrl`을 손으로 쓴 것은 그 자체가 의사표시다. 여기에 활성화를 요구하면 이미
 *   배포된 0.9.x 사용자가 아무 안내 없이 조용히 끊긴다 — 이 툴에서 가장 나쁜 실패 모드다
 * - env는 CI가 넣으므로 **프로덕션 빌드에 섞여 나갈 수 있다.** 그래서 배포 호스트에서는
 *   기기별 활성화를 요구한다. 팀은 프로덕션 빌드에 안심하고 값을 넣어둘 수 있고,
 *   실사용자에게는 아무 일도 일어나지 않는다
 */
export function resolveLiveEndpoint(input: LiveEndpointInput): string | undefined {
  if (nonEmpty(input.explicit)) return input.explicit;

  // 여기부터는 전부 자동 추론이다 — 실제 페이지가 아니면 아무것도 추론하지 않는다
  if (input.userAgent !== undefined && !isRealPage(input.userAgent)) return undefined;

  // 루프백은 그 자체로 활성 상태다. 호출자(`isLiveActivated`)도 같은 판정을 하지만
  // 여기서 한 번 더 본다 — 활성화 게이트가 호출 순서에 의존하면 안 된다
  const loopback = isLoopbackHost(input.hostname);

  // 주입값이 있으면 그대로 쓴다 — 루프백에서도 폴백 포트(+1)로 뜬 허브를 가리킬 수 있다
  if (nonEmpty(input.env)) return input.activated || loopback ? input.env : undefined;

  // 페이지의 호스트명을 유지한다: localhost와 127.0.0.1을 섞으면 이유 없이 오리진이 갈라진다
  return loopback ? `http://${input.hostname}:${DEFAULT_HUB_PORT}` : undefined;
}
