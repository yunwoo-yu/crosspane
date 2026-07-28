---
"crosspane": patch
---

fix: 프로세스 수명주기 견고성 — 엔진 기동 중도 실패 시 브라우저 프로세스가 고아로 남던 문제(잘못된 --inject 경로 등), Android pane 정지 직후 지연 콜백이 gRPC 동기 throw로 프로세스를 죽이던 크래시 경로, 상주 adb shell의 stdin EPIPE uncaught, scrcpy 포워딩 실패 시 기기 위 서버 고아, SDK 버전 디렉터리 사전순 정렬 오선택(android-9 > android-35), 셸 롱폴 응답의 절단 감지 누락, listen 이후 서버 에러 무음 처리 수정. npm 배포물에 shell-sck/ime-android 소스 누락으로 배포본에서만 SCK 캡처·한글 IME가 조용히 죽던 문제 수정
