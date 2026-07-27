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

## iOS (simctl + WKWebView 셸)

- 1순위는 셸앱(`shell/main.swift`, 진짜 WKWebView 컴포넌트 + 입력/콘솔),
  실패 시 Safari view-only 폴백 — 폴백 경로를 지우지 말 것
- 셸 클릭 좌표는 **screen.width/height 매핑 유지** — clientHeight/innerHeight로
  바꾸면 iOS 100vh 문제로 어긋난다 (실측: 중앙 클릭이 BODY에 떨어짐)
- 셸 빌드는 소스 해시로 ~/.crosspane/shell에 캐시 — Swift 소스 수정만으로 재빌드됨
- 시뮬레이터의 localhost == 호스트 맥 — 컨트롤 브릿지가 이 가정 위에 있다
- **Safari 폴백: 선실행 → openurl 순서를 바꾸지 말 것**: 헤드리스 부팅 직후
  openurl은 타임아웃된다 (`launch com.apple.mobilesafari` 후에만 안정)
- Xcode 탐지는 `resolveDeveloperDir()` 경유 — `xcode-select` 설정을 요구하지 말 것
  (DEVELOPER_DIR 우회가 의도된 설계)
- 알려진 한계: 일부 페이지에서 window error가 "Script error."로 마스킹됨(WebKit),
  IME/네이티브 키보드 입력은 미지원 (execCommand insertText 근사)

## Android (adb)

- `adb reverse` 제거 금지 — 기기의 localhost는 기기 자신이다
- URL은 Chrome 컴포넌트 직접 지정(`com.android.chrome/...Main`) 후 VIEW 인텐트 폴백 —
  기본 브라우저 미지정 이미지에서 일반 인텐트는 해석 실패
- 실행 파일 경로는 `adbExecutableName`/`emulatorExecutableName`/`androidSdkCandidateDirs`
  헬퍼만 사용 (Windows `.exe`, OS별 SDK 경로가 여기 몰려 있음)

## 입력 반응성 (실측으로 얻은 구조)

- iOS 셸 명령은 **롱폴**이다: 서버가 `/commands` 응답을 잡아두고 enqueue 시 즉시 응답.
  고정 주기 폴링으로 되돌리면 입력 지연이 주기만큼 다시 생긴다 (250ms 폴링 시절 실측 ~1초)
- 캡처 루프는 `capture-loop.ts` 공용 — `markActivity()`가 `wake()`를 불러 입력 직후
  즉시 캡처한다. wake 경로를 끊으면 화면 반영이 폴링 간격만큼 늦어진다

## iOS 셸 프레임 스트리밍 (전부 실측)

- 셸이 `takeSnapshot`(공개 API)으로 자체 캡처해 `/shell/:engine/frame`으로 push한다 —
  simctl 스크린샷 폴링(왕복 수백 ms)으로 되돌리지 말 것
- **drawHierarchy로 바꾸지 말 것**: WK 컴포지터의 비동기 서피스를 찍어 스크롤 중에도
  프레임의 80%가 동일 바이트였다 (takeSnapshot은 WebKit이 직접 렌더)
- **UIView.animate로 스크롤을 애니메이션하지 말 것**: 모델값이 즉시 최종으로 바뀌어
  스트림에 1프레임만 잡힌다 — 모델값을 30Hz Timer로 직접 스텝한다
- fps 상한 ~5Hz는 takeSnapshot의 콘텐츠 갱신 케이던스 한계다. Simulator.app 창을
  붙여도 동일(실측) — 진짜 30fps는 IOSurface 접근(idb) 필요, 옵션 의존성 로드맵
- 프레임의 scrollY는 프레임 픽셀 단위(contentOffset × pixelsPerPoint)로 보낸다

## Android 셸 (WebView 컴포넌트)

- 1순위는 자체 셸 APK(`shell-android/`, build-tools로 소스 빌드·해시 캐시) —
  Chrome UI 없는 앱 임베드 WebView + 콘솔/내비게이션 릴레이. 실패 시 Chrome 폴백 유지
- 셸 통신은 iOS와 동일 규약(`/shell/android/{commands,event}` 롱폴) — 컨트롤 포트는
  `adb reverse`로 기기에 노출한다 (에뮬레이터의 localhost ≠ 호스트)
- 입력(터치/키)은 시스템 레벨(motionevent/input)이라 셸 앱과 무관하게 동작한다

## 실스트림 (idb / scrcpy)

- iOS: idb 있으면 30fps H.264 스트림이 셸 스냅샷을 대체한다(pauseFrames).
  **idb 스폰에 PYTHONUNBUFFERED=1 필수** — 파이썬 stdout 64KB 블록 버퍼링이
  프레임을 묶어 초 단위 지연을 만든다 (실측 5fps→20fps 차이의 원인)
- H264 트레일링 플러시는 scrcpy(Android) 전용 — idb는 청크 경계가 NAL 경계가
  아니라 잘린 NAL이 디코더를 영구 정지시킨다 (IDR 재전송 없음)
- 에뮬레이터 부팅에 `-gpu host` 유지 — 헤드리스 렌더 fps의 핵심 (7→16fps 실측)
- iOS 화면 소스 기본은 **셸 takeSnapshot(무결점 5fps)** — idb H.264(20fps)는
  잔상 리스크로 CROSSPANE_IOS_H264=1 옵트인, MJPEG는 3fps라 셸보다 못함 (전부 실측)
