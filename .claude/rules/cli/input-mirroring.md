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
- 드래그(제스처)는 **세로 위주면 scrollBy로 변환**할 것 — Playwright mouse 드래그는
  모바일 뷰포트에서 텍스트 선택이 된다 (실측). 가로/자유 드래그만 pointer 시퀀스로 재생
  (iOS 셸도 동일 휴리스틱: 합성 터치는 WKWebView 네이티브 스크롤을 못 움직인다)
- **스크롤/드래그는 pane 독립이다** (커맨드에 engine 지정) — 엔진별 스크롤 물리
  (관성/뷰포트/스케일) 차이로 미러링하면 반드시 어긋나고, Android는 짧은 스와이프
  재생이 탭으로 오인된다(실측: 카드 클릭 유발). 클릭/키/내비게이션만 전 엔진 미러
- Android 스와이프는 MIN_SWIPE_PX 미만 누적 대기 — 터치 슬롭 근처 스와이프는 탭이 된다
- Android 드래그는 **motionevent 연속 터치**(touch 커맨드)다 — 탭/스크롤/관성 판단을
  기기에 맡긴다. 탭 시 다른 엔진 미러는 click+except(android)로 중복 탭을 막는다
