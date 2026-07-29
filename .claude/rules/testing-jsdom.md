---
paths:
  - "packages/dashboard/tests/**"
  - "packages/agent/tests/**"
  - "packages/dashboard/vite.config.ts"
  - "packages/agent/vitest.config.ts"
---

# jsdom 테스트 규칙 (에이전트·대시보드 공용)

두 패키지 모두 jsdom 환경이다. **브라우저 API가 통째로 없거나 반쪽인 경우가 많아,
"jsdom에서 통과 = 실브라우저에서 동작"이 아니다.** 실동작 확인은 `examples/demo` +
`agent-browser`로 (메모리의 검증 절차 참조).

## jsdom에 없어서 스텁이 필요한 것

- `WebSocket` — 없다. 대역 클래스로 스텁하고 `readyState`/`OPEN`까지 흉내낼 것
  (`transport.test.ts`의 `FakeSocket`, `useCrosspaneSocket.test.ts` 참조)
- `PromiseRejectionEvent` — 생성자가 없다. `new Event('unhandledrejection')`에
  `reason` 필드를 실어 dispatch (`agent.test.ts` 참조)
- `Element.scrollIntoView` → `vi.fn()`

## 훅 테스트의 핵심 회귀 지점

에이전트 훅은 **원본 동작 보존**과 **dispose 원복**이 계약이다. 새 훅을 추가하면
반드시 두 가지를 테스트할 것:
1. 원본이 여전히 호출되고 반환값이 그대로인가
2. `dispose()` 후 전역이 원래 함수로 돌아오는가 (`console.log === originalLog`)

## 테스트도 타입체크된다

각 패키지의 `typecheck`는 `tsc -b` 다음에 `tsc -p tsconfig.test.json`을 돌린다
(대시보드는 메인 tsconfig의 include에 `tests`가 들어 있다).

이게 없던 동안 테스트 300여 건이 타입 검증 없이 통과했고, 실제로 어긋난 것이 있었다
(리플레이 테스트의 대역 에이전트에 `copyCapture` 누락, `LogEntry.kind` 누락).
**테스트가 실제 타입과 어긋난 채 초록불이면 신뢰가 가짜다.**

- 메인 tsconfig에 `tests`를 넣을 수 없다 — `rootDir`가 `src`라 dist 구조가 깨진다
- 테스트 설정은 `moduleResolution: bundler` + `module: preserve` — vitest와 같은 해석
  (확장자 없는 상대 경로가 통과해야 한다)
- 워크스페이스 의존은 `paths`로 소스를 가리킨다 (아래 절과 같은 이유)
- `types: ["node"]`는 테스트 설정에만 준다 — 소스가 node API를 쓰는 실수는
  메인 tsconfig가 여전히 잡는다

## 워크스페이스 의존은 소스로 해석한다

각 패키지의 vitest 설정이 `@crosspane/protocol`·`@crosspane/agent`를 **소스 파일**로
alias한다. dist로 해석되게 두면 테스트가 빌드 순서에 묶이고, CI는 test를 build보다
먼저 돌리므로 "Failed to resolve import"로 죽는다 (실제 릴리스를 한 번 막았다).
새 패키지를 추가하면 vitest 설정에 같은 alias를 넣을 것.

## 빌드 산출물을 손으로 지울 때

`rm -rf packages/*/dist`만 하면 `tsc -b`의 증분 정보(`packages/*/tsconfig.tsbuildinfo`)가
남아 "최신"으로 판단해 빌드를 건너뛰고, 의존 패키지가 TS2307로 죽는다 (실측).
`pnpm clean`을 쓸 것 — dist와 tsbuildinfo를 함께 지운다.

## 그 외

- vitest `globals: true`를 끄지 말 것 — testing-library의 auto-cleanup이
  전역 afterEach에 의존한다 (끄면 render가 누적돼 중복 매칭 실패)
- 타이머를 쓰는 테스트(배칭·재접속 백오프)는 `vi.useFakeTimers()` + `advanceTimersByTime`.
  실시간 sleep으로 기다리지 말 것 — CI에서 흔들린다
