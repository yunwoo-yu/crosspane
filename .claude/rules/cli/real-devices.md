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
- 셸 클릭 좌표는 **screen.width/height 매핑 + 상단 인셋 보정** —
  `py = ny * screen.height - adjustedContentInset.top` (네이티브 값 주입).
  WKWebView automatic safe-area 인셋 때문에 페이지 뷰포트가 상태바 아래(62pt)에서
  시작해, 보정 없이는 클릭이 그만큼 아래를 찍는다 (실측: "위를 눌러야 눌림").
  clientHeight/innerHeight 매핑으로 바꾸는 것도 금물 — iOS 100vh 문제로 어긋난다.
  click/scroll(내부 스크롤러 탐색)/drag(pointer 시퀀스) 세 경로 모두 같은 보정 필요
- 셸 빌드는 소스 해시로 ~/.crosspane/shell에 캐시 — Swift 소스 수정만으로 재빌드됨
- **상태바 backdrop(systemChromeMaterial)을 지우지 말 것** — 웹뷰가 전면이라
  콘텐츠가 상태바 뒤로 스크롤되면 그대로 비쳐 보인다 (SCK 창 캡처에 노출, 실측).
  웹뷰를 safe-area 아래로 줄이는 방식은 금물 — screen.width/height 좌표 매핑과
  스냅샷 프레임 화면비가 전면 웹뷰를 전제한다. backdrop은 터치 비활성 오버레이만
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

## iOS sticky/fixed 워밍업 (실측)

- **didFinish의 ±2pt 나노 스크롤을 지우지 말 것** — 페이지 로드 후 "첫"
  프로그래매틱 스크롤(setContentOffset)에서만 sticky/fixed 요소가 한 커밋 늦게
  따라와 이탈해 보인다 (실측: salgu 첫 드래그에서 헤더 위 빈 띠, 실터치(idb HID)는
  첫 스크롤부터 정상 = 웹페이지 문제 아님). 워밍업 커밋 후에는 첫 드래그부터 고정된다
- 나노 스크롤의 복원은 **한 커밋 간격(150ms) 후에** — 같은 틱에 되돌리면
  넷제로로 합쳐져 워밍업이 안 될 수 있다

## 스트림 자가 복구 (실기동 검증)

- **셸 생존 신호는 롱폴이다** — 유휴에도 ~8초마다 재폴링하므로 25초 끊기면 사망.
  프레임 부재를 신호로 쓰지 말 것 (정적 화면과 구분 불가 → 유휴 폴링 오발동).
  감시가 사망을 감지하면 셸을 재실행하고(터미네이트→launch, controlUrl 보존),
  SCK 부재 시에만 simctl 폴링 폴백을 임시로 되살린다
- Android 비디오 exit 시 `resumeCaptureFallback()` — 재spawn 연속 실패에도 pane이
  굳지 않게 폴링을 되살린다. 스트림 복구 시 다음 청크가 폴링을 자가 정지시킨다
  (videoBytesReceived 검사) — 이 자가 정지 구조를 제거하지 말 것

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

## Android 한글 IME (`ime-android/`, 전부 실측)

- adb `input text`는 ASCII 전용 — 비ASCII는 자체 무화면 IME로 커밋한다.
  텍스트는 **base64로 감싼 브로드캐스트**(`--es b64`) — adb shell 인자의 UTF-8이 깨진다
- API 33+에서 adb發 브로드캐스트 수신은 `Context.RECEIVER_EXPORTED` 명시 필수
- **`pm install` 직후 `ime enable`은 실패할 수 있다** — InputMethodManager 등록 지연.
  "now enabled" 응답을 확인하며 재시도한다
- `ime set`으로 선택하면 소프트 키보드 UI가 사라진다(무화면 IME) — 미러링 화면을
  가리지 않는 의도된 동작
- WebView 입력값은 uiautomator 덤프에 안 잡힌다 — 검증은 스크린샷으로

## 실스트림 (idb / scrcpy)

- iOS: idb 있으면 30fps H.264 스트림이 셸 스냅샷을 대체한다(pauseFrames).
  **idb 스폰에 PYTHONUNBUFFERED=1 필수** — 파이썬 stdout 64KB 블록 버퍼링이
  프레임을 묶어 초 단위 지연을 만든다 (실측 5fps→20fps 차이의 원인)
- **H264 트레일링 플러시 금지 (전 소스)** — scrcpy(TCP)도 idb(파이프)도 청크 경계가
  NAL 경계가 아니다. 잘린 NAL은 델타 프레임을 오염시키고 IDR 재전송이 없어 잔상이
  지속된다 (사용자 실검증: 드래그 중 블록 깨짐). 디코더 오류 시 대시보드가
  `restart-video` 커맨드로 스트림 재시작(새 SPS/IDR)을 요청해 자가 회복한다
- 에뮬레이터 부팅에 `-gpu host` 유지 — 헤드리스 렌더 fps의 핵심 (7→16fps 실측)
- iOS 화면 소스 기본은 **셸 takeSnapshot(무결점 5fps)** — idb H.264(20fps)는
  잔상 리스크로 CROSSPANE_IOS_H264=1 옵트인, MJPEG는 3fps라 셸보다 못함 (전부 실측)
- iOS 30fps급 무결점의 정답은 **SCK 창 캡처**(shell-sck) — 시뮬 창 노출 + 화면기록
  권한 필요. 타이틀바 크롭은 기기 화면비 인자 기반 (클릭 좌표 정합)
- SCK는 **무한 재시도**(10초) — 권한을 세션 도중 허용해도 자동 활성돼야 한다.
  `open -g -a Simulator`는 매 재시도 안전 (-g라 포커스를 뺏지 않는다)
- 시청자 0명이면 SCK를 **의도적 정지**(sckPausedForNoViewers)로 멈춘다 — 사망과
  구분되는 플래그라 폴백/재시도가 걸리지 않고, 복귀 시 resumeFrames → SCK 재부착
  핸드오프로 이어진다 (실기동 E2E 검증). 플래그 없이 kill만 하면 사망 복구 경로가
  잘못 발동한다
- **SCK가 세션 도중 죽으면(창 닫힘 등) 반드시 셸 스냅샷을 되살릴 것** —
  붙을 때 `pauseFrames`로 셸을 멈추므로, `resumeFrames`(해시 리셋 포함) +
  captureLoop 재기동 없이는 pane이 마지막 SCK 프레임에서 굳는다 (실측).
  사망 후에도 재시도는 계속 — 창이 복구되면 자동 재부착된다
- 셸 스냅샷 폴백에는 상태바가 없다(webView.takeSnapshot은 웹뷰만 캡처) —
  "상태바가 사라졌다"는 리포트는 SCK가 떨어져 폴백 중이라는 신호다
- Android 입력은 에뮬레이터 gRPC sendTouch(수 ms) — adb input으로 되돌리지 말 것
- idb H.264는 멀티슬라이스 AU 수정 후에도 반복 드래그에서 고스팅 재발(실앱 실측,
  인코더 참조 구조 특성) — 기본 승격 금지, 옵트인 유지. iOS 화면 소스 우선순위는
  SCK(권한 1회, 무결점 고fps) → 셸 스냅샷(무결점 폴백)으로 확정
