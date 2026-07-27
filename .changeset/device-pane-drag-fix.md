---
'crosspane': patch
---

iOS/Android pane 드래그 깨짐·오작동 수정

- **실기기 pane의 로컬 에코 비활성화** — iOS 셸의 스케일드 프레임과 에코 단위가
  어긋나 드래그 시 화면이 밀려 깨지고, Android는 scrollY 미상 프레임마다 transform이
  리셋돼 튀던 문제의 근본 원인. 실기기는 네이티브 스크롤+실시간 스트림이 곧 피드백
- 스크롤 델타 단위 통일: 휠·드래그 모두 표시px→프레임px 환산, iOS 셸은 프레임px→pt
  재환산, Android는 기기px 그대로 (이중 스케일 제거 — 엔진별 이동량 불일치 해소)
- Android 스와이프 duration 140ms — fling 오인으로 관성이 과하게 붙던 것 억제
