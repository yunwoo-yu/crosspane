---
'crosspane': minor
---

실기기 입력 반응성 대폭 개선 + 드래그 미러링

- iOS 셸 명령 채널을 롱폴링으로 전환 — 클릭→반영 왕복 실측 ~1초 → ~120ms
- 입력 직후 즉시 스크린샷 캡처(공용 capture-loop의 wake) — iOS/Android 공통
- 드래그/스와이프 미러링 신설: pane에서 드래그하면 모든 엔진에 재생
  (Android는 진짜 터치 swipe, 브라우저·iOS 셸은 세로=스크롤/가로=pointer 시퀀스)
- 대시보드 UI 디테일: 활성 칩/탭의 지저분한 아웃라인 제거(틴트 배경), 하단 탭·필터·테이블 여백 통일
- 구조 정리: pane 미러링 로직을 usePaneMirroring 훅으로, 패널 높이를 usePanelHeight로 분리,
  실기기 캡처 루프 공용화(capture-loop.ts), 제스처 분류 순수 함수화(input-utils.ts)
