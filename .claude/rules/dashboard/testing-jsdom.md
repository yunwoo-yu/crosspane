---
paths:
  - "packages/dashboard/tests/**"
  - "packages/dashboard/vite.config.ts"
---

# 대시보드 테스트 규칙 (jsdom 제약)

- jsdom에 없는 API는 스텁 필수:
  - `PointerEvent` → `window.PointerEvent = window.MouseEvent`로 대체
    (없으면 fireEvent.pointerDown의 clientX/Y가 유실된다)
  - `Element.scrollIntoView` → `vi.fn()`
  - `createImageBitmap` → fake bitmap 반환 mock
- vitest `globals: true`를 끄지 말 것 — testing-library의 렌더 auto-cleanup이
  전역 afterEach에 의존한다 (끄면 render가 누적돼 중복 매칭 실패)
- 프레임 주입은 `subscribeToFrames`를 가짜로 넘겨 리스너를 캡처하는 패턴 사용
  (`components.test.tsx`의 `renderEnginePane` 참조)
- WS는 `FakeWebSocket`으로 — 바이너리 프레임은 5바이트 헤더를 포함해 만들 것
