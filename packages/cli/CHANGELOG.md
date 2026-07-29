# crosspane

## 0.7.0

### Minor Changes

- 79ed26a: **crosspane is now a webview debugging toolkit.**

  The multi-engine preview (Playwright + iOS Simulator + Android emulator mirroring) is gone.
  It could never reach the environments this project actually cares about: production in-app
  webviews, in-app browsers, and security-hardened builds where remote inspectors are blocked
  outright. That version is preserved at the `crosspane@0.6.2` tag.

  What replaces it:

  - **`@crosspane/agent`** — a dependency-free SDK you embed in dev/QA builds. Hooks console,
    uncaught errors, unhandled rejections, fetch/XHR and navigations into a crash-resistant ring
    buffer. Stream live to the hub over your LAN, or export a `.crosspane.json` capture file when
    the network isn't an option (ISMS-P / MDM locked devices).
  - **`crosspane`** — the hub CLI is now a session relay: receives live agents on `/agent`, serves
    the dashboard, replays history to late-joining dashboards. No browser dependencies, so
    installs are megabytes instead of hundreds.
  - **Dashboard** — session list (multiple devices at once, live/ended, error badges), console and
    network panels, and drag-and-drop replay of capture files through the exact same UI.
  - **`@crosspane/protocol`** — shared wire types, published so integrations can build on them.

### Patch Changes

- Updated dependencies [107330d]
- Updated dependencies [79ed26a]
  - @crosspane/protocol@0.2.0

## 0.6.2

### Patch Changes

- 42e5f29: Docs: new from-scratch Android setup guide (docs/android-setup.md) with an error→fix table, linked from README and from the Android error messages themselves. README CLI reference synced with the actual flags (`--host`, `--ios-runtime`, `--version`, corrected `--port`/`--engines` semantics), CI coverage described accurately, ARCHITECTURE.md updated to the current module map and iOS/Android shell reality.
- 9c3479c: All user-facing text is now English — dashboard UI (toasts, empty states, tooltips, placeholders, diff/network/console panels) and CLI runtime messages (install prompts, fallback warnings, URL convergence logs). Matches the English README and npm listing.
- 857b358: Runtime safety net: global `unhandledRejection`/`uncaughtException` handlers now log the full stack and run the normal shutdown path (previously the process died silently, orphaning browsers/emulators/stream children). Fatal errors keep their stack trace instead of printing only the message. New `--verbose` flag (or `CROSSPANE_VERBOSE=1`) surfaces the causes behind silent fallbacks — CDP screencast failures, capture errors, shell/SCK/IME fallbacks — for actionable bug reports.
- 5a93e19: Security hardening for the dashboard server: binds to 127.0.0.1 by default (new `--host` flag to opt into network exposure, with a warning), WebSocket connections now verify Origin against loopback/same-host (blocks cross-site WebSocket hijacking of the input-mirroring channel), shell bridge endpoints validate the engine name and cap request body size.
- 374a1ac: Add `-v` / `--version` flag (previously it triggered the interactive prompt and then errored). The bug report template asks for the version — now there's a way to get it.
- a1d22c8: Fix fixed/sticky chrome misplacement while dragging in WebKit panes (viewport-mode demotion via pinnedChrome edge probing). Internal refactors: socket hook split into event-log/frame-router/useEventBatcher/useFrameHub, App derived state extracted to session-view, unified shell event parser, expanded test coverage (209 tests).

## 0.6.1

### Patch Changes

- d6e55b4: fix: npm 패키지 페이지에 README/LICENSE가 표시되도록 빌드 시 저장소 루트에서 동기화 (기존에는 패키지 디렉터리에 없어 npm 페이지가 비어 있었다). README 전면 개정 — 베타 안내, 이미 구현된 기능(IME 미러링·네트워크 패널·픽셀 diff·셸앱·세션 유지 등)을 로드맵에서 기능 목록으로 이동, 트러블슈팅 추가. 셸 이벤트 파서 통일 — Android 콘솔 warn 레벨 정규화와 중복 내비게이션 억제가 iOS와 동일해짐

## 0.6.0

### Minor Changes

- 8ff7924: 내부 스크롤 레이아웃 지원(근본 수정) + URL 상시 수렴

  - **내부 스크롤 컨테이너에서 스크롤이 완전히 죽던 문제 해결** — 실무 SPA의 흔한
    레이아웃(overflow 리스트)에서 window.scrollBy가 no-op이라 드래그/휠이 무반응이었음.
    스크롤 커맨드에 포인터 좌표를 실어 그 아래의 실제 스크롤 컨테이너를 찾아 스크롤
    (엔진 3종 + iOS 셸), 프레임 scrollY 리포트도 해당 컨테이너 기준(에코 정합).
    실측: fps 0 → 16-17fps, 첫 반응 91-101ms, 놓는 즉시 정착
  - **URL 어긋남 상시 수렴**: "실차이 보존" 규칙 폐지 — 이유 불문 리더 URL로 계속
    되돌린다 (3초 쿨다운으로 리다이렉트 루프만 방지, 일치할 때까지 재시도)

- 1242ad4: feat: iOS pane 렌더링·복원력 개선 — 셸 상태바에 불투명 배경(systemChromeMaterial)을 깔아 콘텐츠가 상태바 뒤로 비쳐 보이던 문제 해결, 페이지 로드 직후 ±2pt 나노 스크롤 워밍업으로 첫 드래그에서 sticky/fixed 요소가 이탈하던 WebKit 첫-스크롤 지연 제거, 유휴→입력 전환 시 드래그 중간 프레임이 전부 유실되던 스냅샷 파이프라인 수정 (첫 프레임 지연 740ms→130ms). 스트림 자가 복구 체계 추가: SCK 창 캡처가 세션 도중 죽으면 셸 스냅샷 폴백 후 자동 재부착, 셸앱 크래시는 롱폴 생존 감시(25초)로 감지해 자동 재실행, 시청자가 없는 pane은 SCK 캡처를 멈춰 유휴 CPU 제거
- 123c789: feat: Android 한글 입력 지원 — 자체 무화면 IME APK을 소스 빌드·자동 설치해 비ASCII 텍스트를 커밋 (adb `input text`의 ASCII 한계 해소). iOS SCK 캡처는 무한 재시도로 전환 — 화면 기록 권한을 세션 도중 허용해도 재실행 없이 자동 활성

### Patch Changes

- 1242ad4: fix: 대시보드 재접속·성능 — CLI 재시작으로 재접속할 때마다 콘솔/네트워크 로그가 통째로 중복 누적되던 문제(hello를 세션 경계로 처리), 재접속 시 H.264 파이프라인 미리셋으로 인한 첫 프레임 오염 가능성, 이전 소켓의 늦은 close가 연결 상태를 덮어쓰는 레이스 수정. 로그 폭주 시 렌더당 엔진×로그 전체를 재순회하던 에러 배지 계산을 메모이즈하고 pane 리렌더를 차단(React.memo), scrollY 미상 프레임 한 장에 절대 에코가 영구 강등되던 것을 자동 승격 복구로 개선, H.264 보류 버퍼 4MB 상한, 패널 리사이즈 전역 리스너 유실 경로 정리
- 920ec97: 실기기 pane 실앱 검증 라운드 — iOS 셸 내부 스크롤 + SCK 견고화

  - iOS 셸도 좌표 기반 내부 스크롤 컨테이너 지원 — 실무 SPA(overflow 리스트)에서
    드래그 스크롤 동작 (실제 앱으로 검증)
  - SCK 캡처 견고화: 창 준비 전 레이스 재시도(4회), TCC 대기 행에 12초 워치독 —
    권한 미승인 시 명확한 안내 후 셸 스냅샷 폴백 (조용한 성능 저하 제거)

- 504dc9e: feat: 드래그 로컬 에코를 canvas 내부 스트레치 드로우로 전환 — 검은 빈 영역 제거(네이티브 오버스크롤 질감), 에코 상한 12%→22%, scrcpy 비트레이트 8Mbps
- 7458548: fix: Android H.264 드래그 깨짐 제거(잘린 NAL 플러시 폐지 + 디코더 오류 시 스트림 자동 재시작), iOS pane 상대 에코로 드래그 즉시 반응
- 78f047d: fix: iOS pane 클릭/스크롤/드래그 좌표가 상태바 높이만큼 아래를 찍던 문제 수정 — WKWebView safe-area 인셋(62pt)을 좌표 매핑에 보정
- 1242ad4: fix: 프로세스 수명주기 견고성 — 엔진 기동 중도 실패 시 브라우저 프로세스가 고아로 남던 문제(잘못된 --inject 경로 등), Android pane 정지 직후 지연 콜백이 gRPC 동기 throw로 프로세스를 죽이던 크래시 경로, 상주 adb shell의 stdin EPIPE uncaught, scrcpy 포워딩 실패 시 기기 위 서버 고아, SDK 버전 디렉터리 사전순 정렬 오선택(android-9 > android-35), 셸 롱폴 응답의 절단 감지 누락, listen 이후 서버 에러 무음 처리 수정. npm 배포물에 shell-sck/ime-android 소스 누락으로 배포본에서만 SCK 캡처·한글 IME가 조용히 죽던 문제 수정
- c946eb8: fix: SCK 창 캡처 안정화 — Simulator를 백그라운드(-g)로 항상 열어 창 부재로 캡처가 영영 못 붙던 문제 해결, 베젤 표시(ShowChrome) 자동 오프로 타이틀바·베젤이 프레임에 섞이던 크롭 어긋남 제거, 부팅 직후 셸 install 레이스 재시도
- 45e7c49: feat: Android 휠 스크롤을 gRPC 터치 제스처로(fling 없는 정밀 스크롤, adb swipe 대비 시작 지연 제거), scrcpy 해상도 1200→1600·8Mbps→10Mbps, iOS 폴백 스냅샷 유휴 시 풀해상도(선명)

## 0.5.0

### Minor Changes

- bc17ae1: Android 셸 APK — Chrome UI 없는 진짜 앱 웹뷰 + 체감 지연 제거

  - **Android도 앱처럼**: 자체 WebView 셸 APK를 SDK build-tools로 소스에서 빌드해
    설치 — Chrome 주소창/툴바 없이 앱 임베드 웹뷰 그대로 (iOS 셸과 대칭).
    WebView 콘솔·페이지 에러·내비게이션이 대시보드로 릴레이됨. 빌드툴 없으면 Chrome 폴백
  - **상대 에코(시간 감쇠)**: Android 비디오 파이프라인의 구조적 지연(~0.5s) 동안
    드래그 델타를 로컬에서 선행 표시 — 손가락에 즉시 반응하고 스트림이 따라오면 자연 감쇠
  - 터치 무브 스로틀 완화(15ms), 명령 채널은 iOS와 동일한 롱폴 규약으로 통합

- 4ebe928: Android 에뮬레이터 공식 gRPC 입력 — 백로그 완전 제거

  - 에뮬레이터를 `-grpc`로 부팅하고 **공식 EmulatorController API**(Android Studio
    미러링과 동일 경로)로 터치를 주입 — adb input(프로세스+JVM ~35ms/개) 대비 왕복
    수 ms, 드래그 백로그 소멸 (놓는 즉시 정착 실측)
  - proto는 SDK emulator/lib 동봉본을 로드 (배포물에 포함 불필요), 연결 실패 시
    기존 motionevent 폴백
  - 화면은 scrcpy h264 유지 — RAW RGBA(gRPC) 직결도 실측했으나 프레임당 2.5MB의
    WS 배압으로 역효과라 채택 안 함 (패킷 RAW 타입은 향후 활용 위해 유지)

- c898e7c: 스크롤/드래그 pane 독립화 — "각자 움직이고, 입력은 한 번에"

  - **스크롤·드래그는 만지는 pane만 움직인다** (커맨드에 engine 타깃) — 엔진별
    스크롤 물리(관성/뷰포트/스케일) 차이로 미러링하면 위치가 반드시 어긋나고,
    Android는 짧은 스와이프 재생이 탭으로 오인돼 원치 않는 화면 이동까지 발생했음
  - **클릭·타이핑·내비게이션·리로드는 계속 전 엔진 미러** — "한 번 조작해 모든
    엔진에 반영"이라는 핵심 가치는 유지
  - Android 스와이프 최소 길이(60px) 미만은 누적 대기 — 터치 슬롭 근처 스와이프의
    탭 오인 제거

- b7cef54: iOS SCK 창 캡처 — 무결점 30fps급 스트림 (기본 활성)

  - 시뮬레이터 창을 **ScreenCaptureKit**(macOS 공개 API)으로 캡처해 JPEG 연속
    스트림으로 — 프레임 독립이라 **지직/잔상이 원천적으로 불가능**하고 셸 스냅샷(5fps)
    대비 2배 이상 (실측 12fps/283ms)
  - 시뮬레이터 창이 자동으로 열리며(캡처 소스), 화면 기록 권한 미승인 시 안내 후
    셸 스냅샷 폴백. 타이틀바는 기기 화면비 기반 크롭(클릭 좌표 정합 유지)
  - 헬퍼는 swiftc로 소스 빌드·해시 캐시, idb H.264는 CROSSPANE_IOS_H264=1 옵트인 유지

- 50e42ed: 실기기 pane 싱크로율 — 네이티브 터치 스트리밍

  - **Android 연속 터치**: 드래그를 스와이프 조각이 아니라 `input motionevent`
    DOWN→MOVE→UP으로 손가락 그대로 전달 — 탭/스크롤/관성/러버밴드 판단을 기기가
    실제 제스처 속도로 수행 (실기기와 동일한 물리). 탭 시 다른 엔진 미러는
    click+except로 중복 탭 방지
  - Android 비디오 절반 해상도 인코딩 — 파이프라인 지연·대역폭 절감 (pane 표시 크기에 충분)
  - **iOS 로컬 에코 재활성화**: 단위 정합(프레임 px) 후 드래그가 손가락을 즉시 따라오고
    놓으면 실제 위치로 수렴

- b1221c5: 실기기 pane 실스트림 완성 — 측정 루프 기반 (iOS 20fps, Android 16fps)

  - **iOS: idb 30fps H.264 스트림** (설치 시 자동, 셸 스냅샷 폴백) — 스냅샷 5fps 한계 돌파.
    핵심 실측 버그: 파이썬 stdout 64KB 블록 버퍼링 → PYTHONUNBUFFERED=1로 해결
    (5fps/1s 지연 → 20fps/168ms)
  - **Android: 에뮬레이터 `-gpu host` 부팅** — 헤드리스 WebView 렌더 fps 7→16
  - 트레일링 플러시를 scrcpy 전용으로 한정 (idb는 NAL 경계 미보장 → 디코더 영구 정지 실측)
  - scrollY 미상 실스트림 pane은 상대 에코로 자동 전환, 터치 첫 move 즉시 전송
  - 최종 실측: 체감 반응(에코) 55ms, 실콘텐츠 iOS 168ms/20fps · Android 240ms/16fps

- 7af48f5: WebKit/Firefox 스크롤 60fps — 풀페이지 크롭 팬 아키텍처

  - **스크롤이 캡처 주기에서 완전히 분리**: 입력 활성 중에는 페이지 전체를 한 장의
    비트맵으로 받아 대시보드가 로컬에서 잘라 그린다(crop pan) — 콘텐츠 이동이
    입력 레이트(60fps+)로 일어나고, 빠르게 끌어도 빈 영역이 생기지 않음
  - 유휴 시에는 뷰포트 캡처로 수렴 — sticky/fixed 요소까지 실제 화면 그대로
    (풀페이지 캡처의 sticky 위치 한계를 이원 전략으로 해소)
  - 프레임 패킷 v3: flags 바이트(FULL_PAGE) 추가, PaneScreen 렌더러가
    윈도우(스크린캐스트/실기기)·페이지(크롭 팬) 두 모드를 소유
  - `--headed` 실창 모드는 방향 정리 차원에서 제거

### Patch Changes

- a8ba9df: 배지/칩 미세 폴리시

  - 엔진 칩 간격 확대(6px), 배지 있는 탭의 좌우 여백 확보
  - 주소창 팔로우에서 에러 페이지 내부 URL(chrome-error:// 등) 제외

- 3383fb1: 배지 시스템 정리 + 여백 유틸리티 무효화 버그 수정

  - **근본 원인 수정**: app.css의 unlayered 전역 리셋(`* { padding: 0 }`)이 Tailwind v4
    @layer 유틸리티를 전부 무효화해 그동안 p-_/m-_ 여백이 조용히 죽어 있었음 —
    리셋 제거(preflight가 담당)로 탭/필터/테이블 여백이 실제로 적용됨
  - 카운트 배지 통일: 정원형(h-4/min-w-4) 세로 중앙 — 탭·pane 헤더 동일 스타일
  - 탭 에러 배지 기준을 pane 배지와 통일 (엔진별 마지막 내비게이션 이후 합)
  - 연결 상태 표시는 조용하게(점+텍스트), 끊김일 때만 빨간 필로 강조

- 26118c4: iOS/Android pane 드래그 깨짐·오작동 수정

  - **실기기 pane의 로컬 에코 비활성화** — iOS 셸의 스케일드 프레임과 에코 단위가
    어긋나 드래그 시 화면이 밀려 깨지고, Android는 scrollY 미상 프레임마다 transform이
    리셋돼 튀던 문제의 근본 원인. 실기기는 네이티브 스크롤+실시간 스트림이 곧 피드백
  - 스크롤 델타 단위 통일: 휠·드래그 모두 표시px→프레임px 환산, iOS 셸은 프레임px→pt
    재환산, Android는 기기px 그대로 (이중 스케일 제거 — 엔진별 이동량 불일치 해소)
  - Android 스와이프 duration 140ms — fling 오인으로 관성이 과하게 붙던 것 억제

- 27f089c: 입력 체감 지연 근본 개선 — 드래그 실시간 스트리밍

  - **드래그가 손가락을 즉시 따라온다**: 기존에는 놓는 순간(pointerup)에야 한 번에
    재생돼 끌고 있는 동안 아무것도 안 움직였음 → 이제 끌고 있는 동안 스크롤 델타를
    33ms 코얼레싱으로 실시간 스트리밍 + 로컬 에코가 즉시 canvas를 이동 (휠과 동일 체감).
    가로 드래그(캐러셀)만 pointerup에서 drag 커맨드 하나로 재생
  - **클릭 리플**: 클릭 즉시 파란 링 피드백 — 왕복을 기다리지 않음
  - **Android 입력 ~10배 단축**: 입력마다 adb 프로세스를 새로 띄우던 것(~50-150ms)을
    상주 adb shell로 교체 (tap/swipe/keyevent 핫패스)
  - WebKit/Firefox 활성 캡처를 백투백으로 (75ms 대기 제거)
  - 휠/드래그 공용 ScrollStreamer로 구조 정리

- 94fa1e8: iOS 화면 소스 기본값을 무결점 셸로 (지직거림 제거)

  - 기본: 셸 takeSnapshot — 프레임 독립이라 **깨짐이 원천적으로 불가능** (~5fps)
  - `CROSSPANE_IOS_H264=1`: idb H.264 20fps 옵트인 — 빠르지만 델타 손상 시 잔상
    (idb가 주기적 키프레임을 안 보내 복구 불가)
  - idb MJPEG도 실측했으나 3fps로 셸보다 못해 제외. 세 소스의 트레이드오프를 규칙에 기록

- a7ef8e3: 드래그 반응 루프 측정·튜닝 — 체감 55ms

  - **H264 파서 트레일링 플러시**: 마지막 프레임이 다음 시작코드를 기다리며 갇히던
    구조적 지연 제거 (유휴 25ms 시 방출) — Android 스트림 갱신율 7→10fps
  - **상대 에코 드래그 중 유지**: 감쇠가 입력 종료 후에만 시작 — 끌수록 뒤처지던 문제 제거
  - iOS 셸 스냅샷 fast 간격 40ms
  - 실측(자동 측정 루프): 체감 첫 반응 55ms(에코), 실콘텐츠 스트림 Android ~300ms/10fps ·
    iOS ~350ms/5fps — 남은 스트림 지연은 screenrecord 인코더/WebKit 스냅샷의 플랫폼 하한

- be777c3: iOS 스트림 깨짐(잔상/번짐) 수정 + 에코 빈 영역 최소화

  - **멀티 슬라이스 프레임 수정**: Apple 인코더는 한 프레임을 여러 VCL NAL로 쪼개는데
    슬라이스 단위로 디코더에 넣어 잔상·번짐이 발생했음 — first_mb_in_slice==0 판정으로
    슬라이스들을 하나의 액세스 유닛으로 누적 (스크롤 화면 깨짐 해소 실측)
  - 상대 에코 오프셋 상한(캔버스 12%) + 감쇠 300ms — 드래그로 당길 때 노출되던
    검은 영역 최소화

- 3b5c3db: 기기 미연결 경로 성능 라운드 — 백로그 제거·직행 렌더

  - **Android move 백로그 제거**: input 실행(35ms/개)보다 빠른 move가 큐에 쌓여
    드래그가 갈수록 밀리던 문제 — 최신 좌표만 40ms 간격 방출 (settle 즉시 케이스 확인)
  - **VideoFrame 직행 렌더**: 디코더 출력을 createImageBitmap 변환 없이 canvas로
    (프레임당 왕복 제거)
  - iOS 셸 스냅샷 파이프라이닝(동시 2장) 시도 — WebKit 콘텐츠 갱신 케이던스가
    상한이라 fps 불변(실측), 코드는 지연 은닉용으로 유지

- fe5d659: Android 비디오를 scrcpy 서버 스트림으로 (설치 시 자동, screenrecord 폴백)

  - brew scrcpy가 있으면 서버 jar를 push해 MediaCodec 직결 raw H.264 스트림 사용 —
    screenrecord의 구조적 버퍼링 제거. 없으면 기존 screenrecord 폴백
  - 파이프라인 계측 결과 대시보드 디코드→표시는 즉시이며, 남은 지연은
    입력 체인 + 에뮬레이터 렌더/인코딩 구간으로 특정됨 (다음 최적화 대상)

## 0.4.0

### Minor Changes

- a504e43: Android pane 실시간 비디오 스트리밍 + 미러링 구조 재설계

  - **Android가 스크린샷 폴링 대신 실시간 H.264 스트림** (`screenrecord` → WebCodecs 디코드)
    — 스크롤/애니메이션이 실기기처럼 흐르고, 드래그는 네이티브 스와이프(관성 포함)
  - 바이너리 패킷 v2: 타입 바이트 도입 (FRAME=스냅샷, VIDEO=H.264 조각),
    새 대시보드 접속 시 스트림을 키프레임부터 재시작
  - WebCodecs 미지원 브라우저는 스크린샷 폴백 자동 유지
  - 미러링 응집도 재설계: 스크롤 에코를 순수 상태 기계(ScrollEcho)로 분리하고
    프레임/휠/제스처/키보드를 단일 책임 훅으로 분해 (usePaneMirroring은 조립부)
  - 하단 탭바·필터 여백 정리

- 14bf69e: 한글 IME 입력 + 픽셀 diff + 버그 리포트 + iOS pane 인터랙티브 수정

  - **한글 IME 입력 지원**: pane 키 입력을 숨김 input 경유로 바꿔 조합형 입력(한글 등)이
    브라우저 엔진과 iOS WKWebView 셸에서 동작. Android 에뮬레이터는 adb 한계로 비ASCII
    입력 시 콘솔에 안내
  - **Diff 탭**: 두 엔진의 현재 프레임을 픽셀 비교해 다른 영역을 하이라이트 + 차이 비율 표시
  - **⤓ report 버튼**: 엔진별 스크린샷·콘솔·네트워크(에러/4xx 상단 분리)를 단일
    자급자족 HTML로 다운로드 — 이슈에 파일 하나로 첨부
  - **iOS pane view-only 버그 수정**: navigation 이벤트가 engine 상태의 viewOnly/detail을
    덮어써 셸 모드에서도 view-only로 보이던 문제 수정 — WKWebView 셸에서 클릭/타이핑/
    한글 입력이 실제로 동작
  - iOS 셸 keypress 확장: Enter(폼 제출 포함)·화살표 등 특수키 전달
  - WKWebView 셸 실패 시 폴백 이유를 콘솔에 표시 (조용한 view-only 강등 제거)

- 420e760: iOS pane 셸 자체 스트리밍 — simctl 폴링 탈피 (전부 공개 API)

  - 셸앱이 `takeSnapshot`으로 자체 캡처해 호스트로 push — 입력→화면 반영이
    simctl 폴링(왕복 수백 ms) 대비 대폭 단축, 변화 없으면 idle로 CPU 절약
  - 스크롤이 JS `scrollBy`가 아니라 **UIScrollView 네이티브 경로** (드래그는 감속
    스텝 애니메이션) — iOS pane 스크롤이 실기기 감각
  - 프레임에 contentOffset 동봉 → iOS pane에도 스크롤 로컬 에코 적용
  - 서버 셸 브릿지에 프레임 push 라우트(`/shell/:engine/frame`) 추가,
    셸 스트림이 흐르면 simctl 폴링 자동 중단
  - 알려진 한계 문서화: 유효 fps ~5는 WebKit 스냅샷 케이던스 한계 (30fps는 idb 로드맵)

- 884fc9d: 실행 UX 대폭 간소화 + 대시보드 엔진 토글

  - 인터랙티브 질문은 대상 URL 하나만 — 실행 중인 dev 서버 포트를 자동 감지해 선택지로 제안
  - 프로필/포트 질문 제거: pane 구성은 대시보드 툴바의 엔진 토글로, 포트는 사용 중이면 자동 +1 폴백 (`--port` 명시 시에는 폴백 없음)
  - 기동 후 대시보드를 기본 브라우저로 자동 오픈 (`--no-open`으로 끔)
  - 툴바 엔진 토글 칩: 클릭으로 pane 추가/제거 — 중지된 pane은 그리드에서 빠져 나머지가 공간을 채움
  - pane 헤더 ✕ 버튼으로 개별 pane 닫기 (엔진 중지 + 리소스 반환)
  - 중지된 엔진의 과거 URL이 desync 경고를 오염시키지 않도록 판정을 실행 중 엔진으로 한정

- ca14d5f: 실기기 입력 반응성 대폭 개선 + 드래그 미러링

  - iOS 셸 명령 채널을 롱폴링으로 전환 — 클릭→반영 왕복 실측 ~1초 → ~120ms
  - 입력 직후 즉시 스크린샷 캡처(공용 capture-loop의 wake) — iOS/Android 공통
  - 드래그/스와이프 미러링 신설: pane에서 드래그하면 모든 엔진에 재생
    (Android는 진짜 터치 swipe, 브라우저·iOS 셸은 세로=스크롤/가로=pointer 시퀀스)
  - 대시보드 UI 디테일: 활성 칩/탭의 지저분한 아웃라인 제거(틴트 배경), 하단 탭·필터·테이블 여백 통일
  - 구조 정리: pane 미러링 로직을 usePaneMirroring 훅으로, 패널 높이를 usePanelHeight로 분리,
    실기기 캡처 루프 공용화(capture-loop.ts), 제스처 분류 순수 함수화(input-utils.ts)

- a063725: UX 개선 + 메모리/렌더링 성능 정비

  - 콘솔 패널: 레벨 필터(all/log/warning/error) + 텍스트 검색 + 타임스탬프 표시
  - 콘솔 스마트 오토스크롤: 위로 스크롤하면 따라가기 중지, "↓ 최신" 버튼으로 복귀
  - 하단 패널 드래그 리사이즈 (높이 localStorage 유지)
  - pane 그리드가 화면 폭에 맞춰 자동 줄바꿈 (`auto-fit, minmax(340px, 1fr)`)
  - 포커스 모드에서 숨긴 pane은 프레임 구독 해제 — JPEG 디코드 비용 0
  - WS 이벤트 50ms 배칭 — 로그 폭주 시에도 리렌더 초당 최대 20회
  - iOS 셸 명령 큐 상한(200) — 셸 크래시 시 무한 성장하던 메모리 누수 수정

### Patch Changes

- 4e08c6b: 첫 실행/장애 상황 UX 개선 (실사용 감사 1·2차)

  - **브라우저 자동 설치**: Playwright 브라우저가 없으면 명령어 안내 대신 그 자리에서
    다운로드하고 자동 재시도 — `npx crosspane` 첫 실행이 한 번에 동작
  - **dev 서버 다운 안내**: 기동 시 대상 포트를 프로브해 죽어 있으면 CLI에 경고,
    pane에는 빈 화면 대신 "대상 서버에 연결할 수 없어요 — ⟳ 재시도" 배너 표시

- a03b17f: 유휴 비용 제로화 + 세션 안전성

  - **시청자 게이트**: 대시보드 접속자가 0명이면 모든 캡처를 정지 — WebKit/Firefox
    스크린샷 폴링 스킵, Chromium CDP 스크린캐스트 중단, Android screenrecord 인코딩 정지,
    실기기 캡처 루프 대기. 재접속 시 즉시 재개 (실측: 유휴 CPU 0.0%)
  - **로그인 세션 주기 저장(30초)**: 강제 종료(kill)에도 로그인 상태가 유실되지 않음
    (기존에는 정상 종료 시에만 저장)

- 5c169a2: pane별 시청 게이트 + 주소창 팔로우 (실사용 감사 3·5차)

  - **pane별 캡처 게이트**: 대시보드가 실제로 그리는 엔진 목록(watch)을 서버에 알려,
    아무도 안 보는 pane(포커스 모드의 나머지 등)은 서버도 캡처/스트림을 멈춘다.
    클라이언트 0명이면 전체 정지 (기존 전체 게이트를 pane 단위로 세분화)
  - **주소창 팔로우**: 클릭으로 페이지를 옮겨 다니면 URL 바가 현재 위치를 따라간다
    (입력 중에는 덮어쓰지 않음) — 딥링크 확인/복사가 한 번에

- cdd3045: 대시보드 레이아웃·사용성 전면 폴리시

  - 디자인 토큰 리뉴얼: 계층형 다크 서피스 + 토스 블루 액센트, 통일된 라운드/간격
  - 마이크로 인터랙션: 버튼 press 스케일, pane 등장 애니메이션, 기동 중 상태점 펄스, hover 로그 행 하이라이트
  - 액션 피드백 토스트: pane 시작/닫기, 리포트 저장
  - pane 기동 중 스피너 + 실기기 부팅 소요 안내
  - 하단 탭 세그먼트화 + Console 탭 에러 카운트 배지
  - 리사이즈 핸들 그립 스타일, 얇은 스크롤바, 연결 상태 필, 빈 상태 안내 개선

- e0a4715: URL 단일 소스 수렴 — 우발적 어긋남 자동 제거

  - 리더 엔진(chromium > webkit > firefox)의 내비게이션을 기준으로, 어긋난 엔진을
    0.8초 유예 후 자동으로 같은 URL로 수렴시킨다 — "URL 어긋남" 경고를 볼 일 자체가 줄어듦
  - 단, 같은 목표로 되돌렸는데 다시 어긋나는 엔진은 건드리지 않는다 — 그건
    엔진별 실동작 차이(예: WebKit만 세션 만료로 /login 리다이렉트)이고, 이 툴이
    드러내야 할 버그 신호라서 보존 + 기존 어긋남 경고로 표시
  - 트레일링 슬래시 등 표기 차이는 어긋남으로 보지 않음

## 0.3.0

### Minor Changes

- 2fe7ec2: Two debugging-depth upgrades: (1) network rows now expand on click to show
  per-engine response headers and body previews side by side (API requests only,
  size-capped) — see exactly what the 401 body said on WebKit vs the 200 on
  Chromium. (2) `--ios-runtime 17.2` picks a specific installed iOS Simulator
  runtime, reproducing old-iOS-only bugs that the latest WebKit can't show.
- 9b0cbd3: Network panel: every response is collected per engine and grouped by request
  (method+URL) into a comparison table — status and duration side by side across
  engines, with automatic highlighting when engines disagree (e.g. WebKit-only 401).
  Filters for XHR/fetch-only, errors-only and URL search. This directly answers
  "it works on Android but breaks on iOS" debugging: the differing request is
  highlighted the moment it happens.
- 7dfe113: Runtime pane control from the dashboard: every available engine (all three browser
  engines + detected real devices) is always shown as a pane — profiles now only decide
  which ones auto-start. Stopped panes show a ▶ Start button (boot the Android emulator
  or iOS Simulator on demand), running panes can be stopped with ■ to free resources.
  Also adds a focus mode (⤡ to enlarge one pane, Esc to exit) and a URL bar that
  navigates every engine at once.
- 37d8f68: Real WKWebView shell for the iOS Simulator pane: crosspane now compiles and installs
  a tiny native shell app that hosts the actual WKWebView _component_ (not Safari), so
  component-level production behavior — like `navigator.serviceWorker` being undefined
  and killing a script — reproduces exactly. The pane becomes interactive (click/scroll/
  type mirrored via a localhost control bridge) with console, errors and navigation
  relayed into the dashboard. Falls back to Safari view-only if the shell can't build.
  Also: `--ios-runtime <ver>` to pick an installed iOS Simulator runtime.

### Patch Changes

- c037662: Dashboard UI foundation: Tailwind v4 + shadcn-style components (Button/Badge/Input
  with cva variants) replace hand-rolled control styles, keeping the same dark look on
  the existing palette (now promoted to Tailwind theme tokens). Also fixes monorepo
  dev serving a stale bundled dashboard instead of the freshly built one.

## 0.2.0

### Minor Changes

- 0d13067: Login session persistence: each engine's cookies and storage (`storageState`) are
  saved to `~/.crosspane/state/<origin>/<engine>.json` on shutdown and restored on
  the next run — no more re-logging into your app in every engine every time.
  Use `--fresh` to start with a clean session.
