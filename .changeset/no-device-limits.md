---
'crosspane': patch
---

기기 미연결 경로 성능 라운드 — 백로그 제거·직행 렌더

- **Android move 백로그 제거**: input 실행(35ms/개)보다 빠른 move가 큐에 쌓여
  드래그가 갈수록 밀리던 문제 — 최신 좌표만 40ms 간격 방출 (settle 즉시 케이스 확인)
- **VideoFrame 직행 렌더**: 디코더 출력을 createImageBitmap 변환 없이 canvas로
  (프레임당 왕복 제거)
- iOS 셸 스냅샷 파이프라이닝(동시 2장) 시도 — WebKit 콘텐츠 갱신 케이던스가
  상한이라 fps 불변(실측), 코드는 지연 은닉용으로 유지
