# packages/cli

## 모듈 맵

- `index.ts` — 엔트리: 인터랙티브 셋업 → pane 구성(프로필+SDK 가용성) → 세션 병렬 기동
- `args.ts` — 플래그 파싱. 프로필 프리셋(webview/web/device/full) 위에 명시 플래그 덮어쓰기
- `interactive.ts` — TTY 프롬프트. 답변을 argv로 합쳐 기존 파서 재사용
- `session.ts` — `EngineSession`(Playwright) + `InputTarget` 인터페이스 + 웹뷰 UA 빌더
- `ios-simulator.ts` / `android-emulator.ts` — 실기기 어댑터 (`InputTarget` 구현)
- `server.ts` — WS 브로드캐스트/커맨드 미러링, 히스토리·프레임 캐시 재전송
- `static.ts` — 대시보드 정적 서빙 (번들 dist/public > 모노레포 경로)
- `protocol.ts` — ServerEvent/ClientCommand + 프레임 패킷 규약

## 불변 규칙 위치

세부 규칙은 path-scoped로 자동 로드된다 (`.claude/rules/`):

- 프로토콜/패킷/엔진 추가 → `.claude/rules/protocol-sync.md`
- 프레임 파이프라인 → `.claude/rules/cli/frame-pipeline.md`
- 입력 미러링 → `.claude/rules/cli/input-mirroring.md`
- 실기기 어댑터(simctl/adb 함정) → `.claude/rules/cli/real-devices.md`

## 테스트

- `tests/`는 브라우저 불필요 (순수 함수 + 실제 WS 서버 통합)
- 엔진/실기기 실동작은 루트 `pnpm smoke` (chromium) + 로컬 수동 검증
