# packages/cli

## 모듈 맵

- `index.ts` — 엔트리: 인터랙티브 셋업 → pane 구성(프로필+SDK 가용성) → 세션 병렬 기동
- `args.ts` — 플래그 파싱. 프로필 프리셋(webview/web/device/full) 위에 명시 플래그 덮어쓰기
- `interactive.ts` — TTY 프롬프트. 답변을 argv로 합쳐 기존 파서 재사용
- `session.ts` — `EngineSession`(Playwright) + `InputTarget` 인터페이스 + 웹뷰 UA 빌더
- `ios-simulator.ts` / `android-emulator.ts` — 실기기 어댑터 (`InputTarget` 구현)
- `server.ts` — WS 브로드캐스트/커맨드 미러링, 히스토리·프레임 캐시 재전송
- `static.ts` — 대시보드 정적 서빙 (번들 dist/public > 모노레포 경로)
- `protocol.ts` — ServerEvent/ClientCommand + 프레임 패킷 `[engine u8][scrollY i32LE][JPEG]`

## 규칙

- 새 미러링 대상 추가 절차: `InputTarget` 구현 → `protocol.ts`의 `EngineName`/`ENGINE_CODES`/
  `ENGINE_NAMES_BY_CODE` 추가 → dashboard `types.ts`/`constants.ts`(라벨) 동기화 →
  `index.ts`에서 병렬 기동. 입력 불가면 hello의 `viewOnlyEngines`에 명시
- 이벤트는 반드시 `SessionEvents` 경유로 브로드캐스트 (히스토리/재전송이 그 경로에 있음)
- requestfailed는 취소류(`isAbortedRequestError`)를 반드시 필터 — 오탐 배지가 툴 신뢰를 깬다

## 테스트

- `tests/`는 브라우저 불필요 (순수 함수 + 실제 WS로 서버 통합). 엔진 실동작은 루트 `pnpm smoke`
- 실기기 어댑터는 순수 로직(기기 선택/경로/키코드/스와이프 환산)만 유닛테스트 — 나머지는 수동 검증

## 함정 (실측으로 확인된 것)

- simctl: 헤드리스 부팅 직후 `openurl` 타임아웃 → Safari 선실행(`launch com.apple.mobilesafari`) 후 재시도
- adb: 기기 localhost는 기기 자신 → `adb reverse` 필수 / VIEW 인텐트 미해석 → Chrome 컴포넌트 직접 지정 / Chrome FRE 스킵 best-effort
- 폴링 어댑터는 입력 시 `markActivity()`를 불러야 반응이 빨라진다
- Windows: `adb.exe`/`emulator.exe`, `%LOCALAPPDATA%\Android\Sdk` — `androidSdkCandidateDirs` 참조
