---
'crosspane': patch
---

iOS 화면 소스 기본값을 무결점 셸로 (지직거림 제거)

- 기본: 셸 takeSnapshot — 프레임 독립이라 **깨짐이 원천적으로 불가능** (~5fps)
- `CROSSPANE_IOS_H264=1`: idb H.264 20fps 옵트인 — 빠르지만 델타 손상 시 잔상
  (idb가 주기적 키프레임을 안 보내 복구 불가)
- idb MJPEG도 실측했으나 3fps로 셸보다 못해 제외. 세 소스의 트레이드오프를 규칙에 기록
