---
'crosspane': minor
---

Android 셸 APK — Chrome UI 없는 진짜 앱 웹뷰 + 체감 지연 제거

- **Android도 앱처럼**: 자체 WebView 셸 APK를 SDK build-tools로 소스에서 빌드해
  설치 — Chrome 주소창/툴바 없이 앱 임베드 웹뷰 그대로 (iOS 셸과 대칭).
  WebView 콘솔·페이지 에러·내비게이션이 대시보드로 릴레이됨. 빌드툴 없으면 Chrome 폴백
- **상대 에코(시간 감쇠)**: Android 비디오 파이프라인의 구조적 지연(~0.5s) 동안
  드래그 델타를 로컬에서 선행 표시 — 손가락에 즉시 반응하고 스트림이 따라오면 자연 감쇠
- 터치 무브 스로틀 완화(15ms), 명령 채널은 iOS와 동일한 롱폴 규약으로 통합
