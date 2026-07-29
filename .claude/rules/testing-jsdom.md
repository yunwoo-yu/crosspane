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

## 그 외

- vitest `globals: true`를 끄지 말 것 — testing-library의 auto-cleanup이
  전역 afterEach에 의존한다 (끄면 render가 누적돼 중복 매칭 실패)
- 타이머를 쓰는 테스트(배칭·재접속 백오프)는 `vi.useFakeTimers()` + `advanceTimersByTime`.
  실시간 sleep으로 기다리지 말 것 — CI에서 흔들린다
