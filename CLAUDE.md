# crosspane

개발자도구가 닿지 않는 환경(인앱 웹뷰, 인앱브라우저, 키오스크, 보안 잠금 빌드)의
웹 화면을 디버깅하는 툴킷. **제품의 본체는 서버가 아니라 페이지에 내장하는 에이전트다.**

설계 근거는 `ARCHITECTURE.md`, 왜 그렇게 결정했는지는 `docs/decisions.md`
(0.6.x 엔진 미러링을 왜 버렸는지 포함 — 되살리자는 제안 전에 반드시 읽을 것).

## 명령어

```bash
pnpm build              # protocol → agent → agent-replay → dashboard → cli
                        # (cli가 dashboard dist를 dist/public에 번들)
pnpm test               # 전 패키지 vitest
pnpm coverage           # vitest --coverage (임계값 래칫 — vitest.shared.ts 참조)
pnpm typecheck          # 소스 + 테스트 (tsconfig.test.json)
pnpm check:publishable  # 배포본 메타데이터 검사 (workspace: 잔존·README/LICENSE 누락)
pnpm clean              # dist + tsbuildinfo 삭제 (dist만 지우면 tsc -b가 건너뛴다)
pnpm smoke              # E2E: 실제 허브 기동 → 에이전트 왕복·히스토리 재생 (브라우저 불필요)
./node_modules/.bin/biome check --write .
```

## 손으로 확인할 때

```bash
pnpm try                # 허브(:7788) + 데모(:7999)를 함께 — 이걸 쓸 것
pnpm try:lan            # 위와 같고 --host 0.0.0.0 (폰에서 접속)
pnpm hub                # 허브만
pnpm demo               # 데모 페이지만
pnpm mcp                # MCP stdio 서버 (허브가 떠 있어야 한다)
```

포트를 바꾸려면 `CROSSPANE_PORT=7801 PORT=7802 pnpm try` — 데모 페이지의 serverUrl은
serve.mjs가 주입하므로 함께 따라간다(하드코딩하면 조용히 연결 실패한다).
**노출된 허브의 접속 토큰도 같은 경로로 주입된다**(`CROSSPANE_HUB_TOKEN`) — 포트만
넘기던 동안 `pnpm try:lan`이 401로 조용히 깨져 있었다. 주입 경로를 손대면 LAN에서
실제로 세션이 도달하는지까지 확인할 것.

실브라우저 확인은 `agent-browser`로:
```bash
pnpm try &
agent-browser --session cp open http://localhost:7999
agent-browser --session cp snapshot -i        # ref는 페이지 재로드 시 무효화된다
```
**클릭이 안 먹으면** 요소가 뷰포트 밖일 수 있다 — `scrollIntoView` 먼저 의심할 것.
**테스트로 띄운 프로세스는 회차 끝에 반드시 정리한다** (허브가 두 개면 포트 폴백으로
세션이 엉뚱한 곳에 붙어 원인을 찾기 어렵다).

## 하네스 트리 — 컨텍스트는 필요한 만큼만

```
CLAUDE.md                     ← 공통 명령어/규칙 (항상 로드)
packages/*/CLAUDE.md          ← 패키지 모듈 맵 (해당 디렉터리 작업 시)
│   agent / agent-replay / cli / dashboard
.claude/rules/                ← 불변 규칙 (paths: 매칭 파일을 건드릴 때만)
├── agent-sdk.md                번들 크기·페이지 무영향·게이팅·링버퍼·주소 해석 게이트
├── protocol-sync.md            프로토콜 단일 소스·이벤트 추가 절차
├── mcp-server.md               crosspane mcp: stdout 전용 채널·툴 추가 절차
├── release.md                  릴리스 PR의 CI 미트리거·필수 체크 이름 함정
├── dashboard-render-window.md  라이브/리플레이 상한 차이·렌더 상한 (실측 근거)
└── testing-jsdom.md            jsdom 스텁·훅 계약 테스트 (agent+dashboard 공용)
docs/decisions.md             ← 구조 결정과 그 근거 (기여자·미래의 나 대상)
```

새 불변식이 생기면(특히 실측으로 알아낸 함정) 해당 스코프의 rules 파일에 추가할 것.
구조적 판단이 바뀌면 `docs/decisions.md`에 사유를 남길 것.

## 공통 규칙 (항상 적용)

- 검증 순서: `biome ci .` → `check:publishable` → `typecheck` → `test` → `build`
  → 동작이 바뀌면 `smoke`. 커버리지 임계값은 CI의 ubuntu/Node22 레그에서만 걸린다
  (`pnpm coverage`로 로컬 재현) — 임계값은 래칫이니 내리려면 커밋 메시지에 사유를 남길 것
- push 전 `biome ci`는 필수 — `check --write`가 통과해도 `ci`(=CI와 동일 판정)는
  실패할 수 있다 (suppression 유효성, 일부 a11y 룰)
- 커밋: conventional commits. pre-commit(husky)이 biome를 강제, CI(3-OS × Node 20/22
  + smoke)가 최종 게이트
- **에이전트 패키지는 기준이 다르다** — 사용자 앱 번들에 들어가므로 의존성 0,
  번들 크기, 페이지 동작 무영향이 최우선 (`.claude/rules/agent-sdk.md`)
- 사용자 노출 문구는 영어 / 코드 주석·rules 문서는 한국어
- 배포는 changeset → "chore: version packages" PR 머지로 자동. 로컬 `npm publish` 금지
  (workspace 명세 미치환 사고 이력 — `docs/decisions.md` 참조)
