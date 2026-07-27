---
'crosspane': patch
---

Android 비디오를 scrcpy 서버 스트림으로 (설치 시 자동, screenrecord 폴백)

- brew scrcpy가 있으면 서버 jar를 push해 MediaCodec 직결 raw H.264 스트림 사용 —
  screenrecord의 구조적 버퍼링 제거. 없으면 기존 screenrecord 폴백
- 파이프라인 계측 결과 대시보드 디코드→표시는 즉시이며, 남은 지연은
  입력 체인 + 에뮬레이터 렌더/인코딩 구간으로 특정됨 (다음 최적화 대상)
