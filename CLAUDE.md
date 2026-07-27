# crosspane

로컬 dev 서버를 멀티 엔진(Chromium/WebKit/Firefox) + 실기기(Android 에뮬레이터/iOS 시뮬레이터) pane으로 미러링하는 웹뷰 QA 대시보드. 설계 배경과 기술 선택 근거는 `ARCHITECTURE.md`.

## 명령어

```bash
pnpm build        # dashboard → cli 순서로 빌드 (cli가 dashboard dist를 dist/public에 번들)
pnpm test         # 전 패키지 vitest
pnpm typecheck
pnpm smoke        # E2E 스모크: 실제 서버+chromium 기동 → 프레임/콘솔/입력 검증
./node_modules/.bin/biome check --write .   # 포맷+린트
```

- 브라우저 바이너리: `pnpm --filter crosspane exec playwright install chromium webkit firefox`
  (pnpm 10이 postinstall을 차단하므로 루트가 아닌 cli 패키지에서 실행해야 함)
- 로컬 실행: `crosspane` (pnpm link --global 되어 있음) 또는 `node packages/cli/dist/index.js`

## 구조 — 상세는 각 도메인 하네스 참조

- `packages/cli/` — 엔진·실기기 세션, WS 서버, 프로토콜 → `packages/cli/CLAUDE.md`
- `packages/dashboard/` — React 대시보드 → `packages/dashboard/CLAUDE.md`

## 불변 규칙

- **프로토콜 이중화**: `packages/cli/src/protocol.ts` ↔ `packages/dashboard/src/types.ts`는
  수동 미러 — 한쪽을 바꾸면 반드시 양쪽 수정 (컴파일러가 드리프트를 못 잡는다)
- 검증 순서: biome → `pnpm test` → `pnpm build` → 동작이 바뀌는 변경이면 `pnpm smoke`
- 커밋: conventional commits. pre-commit(husky)이 biome를 강제, CI(3-OS 매트릭스)가 최종 게이트
- 성능 원칙: 프레임은 React 상태에 넣지 않는다 / 유휴 시 WS 트래픽 0을 유지한다
- 크로스 플랫폼: OS별 경로·실행파일 분기는 순수 함수로 분리해 유닛테스트할 것
