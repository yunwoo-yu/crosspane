---
'crosspane': minor
---

실기기 pane 실스트림 완성 — 측정 루프 기반 (iOS 20fps, Android 16fps)

- **iOS: idb 30fps H.264 스트림** (설치 시 자동, 셸 스냅샷 폴백) — 스냅샷 5fps 한계 돌파.
  핵심 실측 버그: 파이썬 stdout 64KB 블록 버퍼링 → PYTHONUNBUFFERED=1로 해결
  (5fps/1s 지연 → 20fps/168ms)
- **Android: 에뮬레이터 `-gpu host` 부팅** — 헤드리스 WebView 렌더 fps 7→16
- 트레일링 플러시를 scrcpy 전용으로 한정 (idb는 NAL 경계 미보장 → 디코더 영구 정지 실측)
- scrollY 미상 실스트림 pane은 상대 에코로 자동 전환, 터치 첫 move 즉시 전송
- 최종 실측: 체감 반응(에코) 55ms, 실콘텐츠 iOS 168ms/20fps · Android 240ms/16fps
