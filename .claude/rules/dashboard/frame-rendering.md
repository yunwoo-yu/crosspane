---
paths:
  - "packages/dashboard/src/components/**"
  - "packages/dashboard/src/hooks/**"
---

# 대시보드 렌더링/입력 불변식

- **프레임을 React 상태에 넣지 말 것** — `subscribeToFrames` 구독으로 canvas에
  직접 그린다. 상태에 넣는 순간 프레임당 리렌더가 발생한다 (성능 계약)
- 로컬 에코(스크롤 예측):
  - 프레임 도착 시 에코를 **무조건 리셋하지 말 것** — 고무줄 튐이 난다.
    `localTarget − frame.scrollY` 차이만큼만 transform을 유지해 수렴시킨다
  - `scrollY < 0`(미상, 실기기 pane)이면 에코를 적용하지 않는다
- wheel은 **non-passive 네이티브 리스너**로 붙인다 — React `onWheel`은 passive라
  preventDefault가 불가능하고, 막지 않으면 대시보드 자체가 스크롤된다
- 휠 델타는 `WHEEL_COALESCE_MS` 동안 합산 후 1개 커맨드로 — 건당 전송 금지
- view-only pane은 클릭/휠/키 핸들러를 붙이지 않고, URL desync 판단에서도 제외한다
- 전달받은 `ImageBitmap`은 디스패치 직후 close된다 — 콜백 밖으로 유출 금지
