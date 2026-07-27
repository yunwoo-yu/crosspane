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

## 하네스 트리 — 컨텍스트는 필요한 만큼만

```
CLAUDE.md                      ← 공통 명령어/규칙 (항상 로드)
packages/*/CLAUDE.md           ← 도메인 모듈 맵 (해당 디렉터리 작업 시 로드)
.claude/rules/                 ← 불변 규칙 (paths: 매칭 파일을 건드릴 때만 로드)
├── protocol-sync.md             프로토콜 단일 소스·프레임 패킷·엔진 추가 절차
├── cli/{frame-pipeline, input-mirroring, real-devices}.md
└── dashboard/{frame-rendering, testing-jsdom}.md
```

새 불변식이 생기면(특히 실측으로 알아낸 함정) 해당 스코프의 rules 파일에 추가할 것.

## 공통 규칙 (항상 적용)

- 검증 순서: biome → `pnpm test` → `pnpm build` → 동작이 바뀌는 변경이면 `pnpm smoke`
- push 전에는 `./node_modules/.bin/biome ci .`로 확인 — `check --write`가 통과해도
  `ci`(=CI와 동일 판정)는 실패할 수 있다 (suppression 유효성, 일부 a11y 룰)
- 커밋: conventional commits. pre-commit(husky)이 biome를 강제, CI(3-OS + smoke)가 최종 게이트
- 성능 원칙: 프레임은 React 상태에 넣지 않는다 / 유휴 시 WS 트래픽 0을 유지한다
- 크로스 플랫폼: OS별 경로·실행파일 분기는 순수 함수로 분리해 유닛테스트할 것
