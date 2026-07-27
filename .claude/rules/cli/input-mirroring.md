---
paths:
  - "packages/cli/src/session.ts"
  - "packages/cli/src/server.ts"
---

# 입력 미러링 불변식

- 스크롤은 `scrollBy` JS 주입 유지 — `mouse.wheel`로 되돌리지 말 것.
  근거(실측): WebKit 모바일 컨텍스트는 wheel을 무시하고, 엔진별 스크롤
  애니메이션 속도 차이로 위치가 어긋난다
- 미러링은 `Promise.allSettled` — 한 엔진의 실패(내비게이션 중 등)가
  나머지를 막으면 안 된다
- 모든 입력 경로에서 `session.markActivity()` 호출 유지 — 폴링 엔진의
  반응 부스트가 여기에 걸려 있다
- `requestfailed`의 취소류 필터(`isAbortedRequestError`)를 제거하지 말 것 —
  Next.js prefetch 취소 등이 에러 배지를 오염시킨다 (배지 9 오탐 실측)
- 클릭 좌표는 0~1 정규화로 받는다 — 픽셀 좌표를 넘기는 클라이언트를 가정하지 말 것
