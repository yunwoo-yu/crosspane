---
paths:
  - "packages/cli/src/ios-simulator.ts"
  - "packages/cli/src/android-emulator.ts"
---

# 실기기 어댑터 규칙 (전부 실측으로 얻은 것)

## 공통

- `InputTarget` 전체 구현 필수. 입력 불가 어댑터는 no-op + hello의
  `viewOnlyEngines` 등록 (조용한 미구현 금지)
- `dispose()`에서 시뮬레이터/에뮬레이터를 종료하지 말 것 — 부팅 상태 유지가
  다음 실행 속도의 핵심
- 어댑터 실동작은 CI에서 검증 불가 — 순수 로직(기기 선택/경로/환산)만 유닛테스트,
  동작 변경 시 로컬에서 실제 기동으로 확인할 것

## iOS (simctl)

- **Safari 선실행 → openurl 순서를 바꾸지 말 것**: 헤드리스 부팅 직후
  openurl은 타임아웃된다 (`launch com.apple.mobilesafari` 후에만 안정)
- Xcode 탐지는 `resolveDeveloperDir()` 경유 — `xcode-select` 설정을 요구하지 말 것
  (DEVELOPER_DIR 우회가 의도된 설계)

## Android (adb)

- `adb reverse` 제거 금지 — 기기의 localhost는 기기 자신이다
- URL은 Chrome 컴포넌트 직접 지정(`com.android.chrome/...Main`) 후 VIEW 인텐트 폴백 —
  기본 브라우저 미지정 이미지에서 일반 인텐트는 해석 실패
- 실행 파일 경로는 `adbExecutableName`/`emulatorExecutableName`/`androidSdkCandidateDirs`
  헬퍼만 사용 (Windows `.exe`, OS별 SDK 경로가 여기 몰려 있음)
