# crosspane 아키텍처

> 웹뷰로 배포되는 앱을 실제 배포 환경(엔진·UA·실기기)과 같은 조건에서,
> 한 대시보드에서 검증하는 도구. 이 문서는 전체 구조와 각 기술 선택의 근거를 기록한다.

## 전체 구조

```
┌─ packages/cli (npm: crosspane) ─────────────────────────────────────┐
│                                                                     │
│  index.ts ── CLI 엔트리, pane 구성(프로필), 세션 오케스트레이션        │
│  args.ts ─── 플래그 파싱 + 프로필 프리셋                              │
│                                                                     │
│  session.ts ────────── EngineSession (Playwright: chromium/webkit/  │
│                        firefox) — InputTarget 구현                   │
│  ios-simulator.ts ──── IosSimulatorSession (simctl) — InputTarget    │
│  android-emulator.ts ─ AndroidEmulatorSession (adb) — InputTarget    │
│                                                                     │
│  server.ts ── HTTP(대시보드 서빙) + WebSocket(이벤트/프레임/커맨드)   │
│  static.ts ── 정적 파일 서빙 (경로 탈출 방어, SPA 폴백)               │
│  protocol.ts ─ 이벤트/커맨드 타입 + 바이너리 프레임 패킷 규약          │
│  lib.ts ────── 라이브러리 공개 API                                   │
└─────────────────────────────────────────────────────────────────────┘
                    ▲ WebSocket (JSON 이벤트 + 바이너리 프레임)
                    ▼
┌─ packages/dashboard (React + Vite) ─────────────────────────────────┐
│  useCrosspaneSocket ── 연결/재접속, 이벤트 상태, 프레임 구독 허브      │
│  EnginePane ── canvas 렌더링, 로컬 에코, 입력 캡처(클릭/휠/키)        │
│  Toolbar ── back/forward/reload, URL 어긋남 재동기화                  │
│  ConsolePanel ── 엔진별 콘솔/에러/네트워크 타임라인                    │
└─────────────────────────────────────────────────────────────────────┘
```

데이터 흐름 (프레임): 엔진 → JPEG 캡처 → `[엔진코드 u8][scrollY i32LE][JPEG]` 바이너리 패킷
→ WS → `createImageBitmap`(오프메인 디코딩) → canvas 직접 드로우 (React 상태 미경유).

데이터 흐름 (입력): pane 이벤트 → 정규화/합산 → JSON 커맨드 → 모든 `InputTarget`에 미러링.

## 기술 선택과 근거

### 오케스트레이션: Playwright

- **왜**: Chromium/WebKit/Firefox 세 엔진을 단일 API로 구동할 수 있는 유일한 도구.
  특히 WebKit을 macOS/Linux/Windows에서 돌릴 수 있는 빌드를 제공 — iOS 근사 검증의 기반.
- 대안이었던 Responsively류(iframe + 단일 Chromium)는 뷰포트만 바꿀 뿐
  엔진 차이를 볼 수 없어 목적에 부합하지 않음.

### 프레임 파이프라인

| 기술 | 근거 |
|---|---|
| Chromium: CDP screencast | 화면이 변할 때만 브라우저가 프레임을 푸시 → 유휴 트래픽 0, 인터랙션 시 네이티브 프레임레이트. 폴링 방식의 근본 한계(고정 fps, 유휴 낭비)를 제거 |
| WebKit/Firefox: 적응형 폴링 | 두 엔진은 screencast API가 없음. 유휴 400ms/활동 75ms 폴링 + 변화 없는 프레임 전송 생략 + 입력 시 대기 중 폴링 즉시 wake |
| `scale: 'css'` 캡처 | iPhone 15 프리셋은 DPR 3 → 기본 캡처는 1170×2532로 픽셀이 9배. CSS 픽셀 캡처로 프레임당 ~300KB → 35KB (실측) |
| 바이너리 WS 패킷 | base64 JSON은 +33% 크기와 파싱 비용. `[엔진코드][scrollY][JPEG]` 규약으로 제거. scrollY는 로컬 에코 보정용 |
| `createImageBitmap` + canvas | JPEG 디코딩을 메인 스레드 밖에서 수행, 프레임을 React 상태에 넣지 않고 구독 방식으로 canvas에 직접 그림 → 프레임당 리렌더 비용 0 |
| 프레임 캐시(엔진별 최신 1장) | 변화 감지 도입의 부작용 해결 — 늦게 접속한 클라이언트도 즉시 화면을 받는다 |

### 입력 파이프라인

| 기술 | 근거 |
|---|---|
| 정규화 좌표(0~1) | 대시보드 표시 크기 ≠ 엔진 뷰포트 크기. 서버가 각 타깃의 실제 해상도로 환산 |
| 휠 합산(33ms) | 트랙패드는 초당 수십 이벤트 — 건당 전송하면 엔진 큐가 밀려 수 초씩 밀림(실측 40이벤트→40커맨드). 합산으로 백로그 제거 |
| `scrollBy` JS 주입 | `mouse.wheel`은 WebKit 모바일 컨텍스트에서 무시되고 엔진별 스크롤 애니메이션 속도가 달라 위치가 어긋남. JS 주입은 세 엔진이 항상 같은 픽셀만큼 이동 |
| 로컬 에코 + scrollY 보정 | 서버 왕복(수백 ms)을 기다리면 스크롤이 계단식으로 보임. 휠 즉시 canvas를 CSS transform으로 이동(60fps 체감)하고, 프레임 헤더의 scrollY와 목표의 차이만큼만 에코를 유지 → 고무줄 현상 없이 수렴. 원격 데스크톱(VNC)과 같은 접근 |
| 키보드: `type`/`keypress` 분리 | 문자는 `keyboard.type`(IME 안전), 특수키는 `keyboard.press`. OS 단축키(cmd+…)는 대시보드에 남김 |

### 배포 환경 정합 (기본 켜짐)

| 기술 | 근거 |
|---|---|
| Android WebView UA (`; wv)` 토큰) | 앱들이 UA 스니핑으로 웹뷰를 감지해 분기함 — 브라우저 UA로 테스트하면 프로덕션과 다른 코드 경로가 실행된다 |
| WKWebView UA (Safari 토큰 없음) | 동일 근거. WKWebView는 Safari와 달리 `Version/x Safari/x` 토큰이 없다 |
| WebKit 서비스워커 차단 | 실제 WKWebView는 App-Bound Domains 설정 없이는 SW 미지원 — SW 의존 코드가 로컬에서만 동작하는 함정 방지 |
| `--user-agent` / `--inject` | 앱의 커스텀 UA와 네이티브 브릿지(`window.ReactNativeWebView` 등)를 mock으로 재현하는 확장 지점 |

### 실기기 레이어

| 기술 | 근거 |
|---|---|
| `InputTarget` 인터페이스 | Playwright 세션과 실기기 어댑터가 같은 미러링 파이프라인에 꽂히는 구조. 새 어댑터(예: USB 실기기) 추가 시 대시보드/서버 무수정 |
| iOS: simctl (view-only) | Xcode만 있으면 추가 의존성 없이 실제 Apple iOS 빌드를 구동. `DEVELOPER_DIR` 우회로 xcode-select 설정 불필요. 입력 주입 채널이 없어(idb/WebDriverAgent 필요) view-only — 한계를 UI에 명시하고 desync 판단에서 제외 |
| iOS: Safari 선실행 | 헤드리스 부팅 직후 `simctl openurl`이 타임아웃되는 문제를 `simctl launch com.apple.mobilesafari` 선실행으로 해결 (실측으로 발견) |
| Android: adb | `input tap/swipe/text/keyevent`로 완전한 입력 미러링 가능 — iOS와 달리 인터랙티브. USB 실기기도 같은 코드로 동작 |
| `adb reverse` | 에뮬레이터의 localhost는 기기 자신 — 개발 머신의 dev 서버로 포워딩 필수 |
| Chrome 컴포넌트 직접 지정 + FRE 스킵 | 기본 브라우저 미지정 이미지에서 VIEW 인텐트가 해석되지 않는 문제, 첫 실행 화면이 막는 문제를 자동화 |

### 신뢰성 (진짜 에러만 보이게)

| 기술 | 근거 |
|---|---|
| 요청 취소 필터 (`ERR_ABORTED` 등) | Next.js prefetch 취소 같은 정상 동작이 에러 배지를 오염시켜(실측: 멀쩡한 앱에 배지 9) 진짜 에러가 묻힘 |
| HTTP 4xx/5xx 수집 | 실배포 웹뷰 장애의 대부분은 API 실패 — 네트워크 레벨 실패(requestfailed)만으로는 잡히지 않음 |
| 내비게이션 추적 + URL 어긋남 감지/재동기화 | 미러링은 엔진별 타이밍 차이로 어긋날 수 있음(실사용에서 발생 확인). 감지 불가능한 문제를 감지 가능하게 + 원클릭 복구 |
| 에러 배지 = 마지막 내비게이션 이후만 | 이전 페이지의 에러가 현재 화면의 상태처럼 보이는 것 방지 |
| 이벤트 히스토리/상태 재전송 | 대시보드를 늦게 열거나 새로고침해도 콘솔 타임라인 유지 |
| WS 자동 재접속 | CLI 재시작이 잦은 개발 흐름에서 대시보드 새로고침 불필요 |

### 프로필 (pane 구성)

- **왜**: 유스케이스별 필요 pane이 다름. 웹뷰 앱 QA에 Gecko 웹뷰는 존재하지 않고(Firefox 불필요),
  실기기 pane은 부팅 비용이 커서 상시용이 아님.
- `webview`(기본): Chromium+WebKit — 매일 켜두는 빠른 루프
- `web`: +Firefox — 모바일 웹 크로스브라우징
- `device`/`full`: +실제 Android/iOS — 배포 전 최종 확인 (SDK 자동 감지)

### 개발 인프라

| 기술 | 근거 |
|---|---|
| pnpm 워크스페이스 | cli(배포물)와 dashboard(프론트)의 의존성/빌드 분리. 대시보드는 private — 배포 시 cli에 번들 예정 |
| TypeScript strict + NodeNext | 프로토콜(이벤트/커맨드)이 양 패키지에 걸쳐 있어 타입 안전이 회귀 방지의 핵심 |
| Biome | 포맷터+린터 단일 도구 — 설정 충돌 없음, ms 단위 속도라 pre-commit에 부담 없음 |
| Vitest | cli(node)와 dashboard(jsdom)를 같은 러너로. 서버는 실제 WebSocket으로 통합 테스트 |
| husky + lint-staged | 커밋은 빠르게(Biome만), 테스트/빌드는 CI가 게이트 |
| GitHub Actions | biome ci → test → build. 로컬을 통과한 것만 원격에 존재하도록 |

## 메모리·데이터 구조 설계

이벤트 스트림(로그/네트워크)이 무한히 쌓이는 도구 특성상, 모든 버퍼는 상한이 있어야 한다.

| 버퍼 | 위치 | 상한 | 초과 시 |
|---|---|---|---|
| 로그 | dashboard 상태 | 500 | 앞에서 잘림 |
| 네트워크 | dashboard 상태 | 800 | 앞에서 잘림 |
| 이벤트 히스토리(재접속 재전송) | cli 서버 | 300 | 앞에서 잘림 |
| 네트워크 히스토리 | cli 서버 | 600 | 앞에서 잘림 |
| 셸앱 명령 큐 | cli `ios-simulator.ts` | 200 | 오래된 명령 폐기 (셸 크래시로 폴링이 멈춰도 무한 성장 방지) |
| 프레임 | 상태에 넣지 않음 | 엔진당 최신 1개(서버 캐시) | — |

**이벤트 배칭(50ms)**: WS 이벤트를 건별로 `setState`하면 로그 폭주 시(예: 무한 루프
console.log) 초당 수백 번 리렌더가 난다. 수신 이벤트는 ref 큐에 쌓고 50ms마다 한 번에
반영해 리렌더를 최대 초당 20회로 캡했다. 상한 잘라내기도 플러시 시점에 1회만 수행.

**검토 후 채택하지 않은 것들** (규모가 근거):
- **링 버퍼 + `useSyncExternalStore`**: append를 O(1)로 만들고 React 밖에서 버퍼를
  관리하는 최종형. 현재는 배칭으로 복사 비용이 플러시당 1회(≤500개 배열)라 체감 차이가
  없어 보류. 로그 상한을 수천 단위로 올리게 되면 이 구조로 전환한다
- **리스트 가상화(react-window 등)**: 행 상한이 500~800이라 DOM 부담이 작고,
  가상화는 sticky 헤더·행 확장(네트워크 상세)과 충돌 비용이 크다. 상한을 올리기
  전까지는 도입하지 않는다
- **네트워크 증분 그루핑(Map 유지)**: 현재는 필터 변경마다 O(n) 재그루핑이지만
  n≤800 + `useMemo`라 ms 미만. 정렬/집계 기능이 추가되면 재검토

**pane 레이아웃**: 엔진 수가 가변(2~5+)이라 CSS Grid
`repeat(auto-fit, minmax(340px, 1fr))`로 브라우저에 배치를 위임 — 패킹 알고리즘을
직접 들 이유가 없다. 포커스 모드에서는 숨긴 pane이 프레임 구독을 해제해 JPEG 디코드
비용도 0이 된다(canvas는 마지막 프레임 유지).

## 알려진 한계

- 실기기 pane은 Chrome/Safari 앱을 엶 — 웹뷰 "컴포넌트" 그 자체는 아님 (같은 엔진).
  컴포넌트 레벨 100%는 자체 WKWebView/WebView 셸앱이 최종형
- Android 에뮬레이터 pane은 비ASCII 입력(한글 등) 불가 — adb `input text`의 한계.
  브라우저 엔진/iOS 셸 pane은 숨김 input + IME 조합으로 한글 입력 지원
- 삼성 인터넷 등 서드파티 브라우저는 실기기/APK 필요

## 로드맵

1. npm 배포 패키징 (대시보드를 cli dist에 번들)
2. WKWebView/WebView 셸앱 — 컴포넌트 레벨 정합 + iOS 입력 미러링
3. 엔진 간 스크린샷 픽셀 diff (pixelmatch)
4. `--android-browser` (삼성 인터넷 등 브라우저 지정)
5. changesets 릴리스 자동화
