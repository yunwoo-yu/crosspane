---
paths:
  - "packages/cli/src/session.ts"
  - "packages/cli/src/server.ts"
---

# 프레임 파이프라인 불변식

- `page.screenshot`의 `scale: 'css'`를 제거하지 말 것 — DPR 3 기기에서 픽셀 9배
  (프레임 ~300KB→35KB 실측). CDP screencast의 `maxWidth/maxHeight`도 같은 목적
- CDP screencast는 `screencastFrameAck`를 보내지 않으면 다음 프레임이 오지 않는다
- 변화 감지(`lastFrame.equals`) ↔ 서버의 엔진별 프레임 캐시는 **커플링**이다:
  감지를 없애면 늦게 접속한 클라이언트 처리(캐시 재전송)도 함께 재검토할 것
- 캡처 루프는 순차 실행(겹침 금지)이며 `wakeCapture`로만 조기 기상시킨다 —
  setInterval로 바꾸면 캡처 지연 시 큐가 쌓인다
- 프레임 브로드캐스트는 `broadcastFrame`(캐시 기록 포함) 경유만.
  이벤트는 `broadcastEvent`(히스토리 기록 포함) 경유만
- 유휴 시 WS 트래픽 0이 성능 계약이다 — 주기적 무조건 전송을 추가하지 말 것
