# crosspane

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
