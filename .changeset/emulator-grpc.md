---
'crosspane': minor
---

Android 에뮬레이터 공식 gRPC 입력 — 백로그 완전 제거

- 에뮬레이터를 `-grpc`로 부팅하고 **공식 EmulatorController API**(Android Studio
  미러링과 동일 경로)로 터치를 주입 — adb input(프로세스+JVM ~35ms/개) 대비 왕복
  수 ms, 드래그 백로그 소멸 (놓는 즉시 정착 실측)
- proto는 SDK emulator/lib 동봉본을 로드 (배포물에 포함 불필요), 연결 실패 시
  기존 motionevent 폴백
- 화면은 scrcpy h264 유지 — RAW RGBA(gRPC) 직결도 실측했으나 프레임당 2.5MB의
  WS 배압으로 역효과라 채택 안 함 (패킷 RAW 타입은 향후 활용 위해 유지)
