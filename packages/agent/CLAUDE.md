# packages/agent

사용자 앱 번들에 들어가는 계측 SDK. **불변식은 `.claude/rules/agent-sdk.md`에 있다**
(의존성 0 / 페이지 무영향 / 게이팅 / 링버퍼) — 수정 전에 반드시 읽을 것.

## 모듈 맵

- `index.ts` — `initCrosspane` 게이팅·세션 생성·조립, `capture()`/`exportFile()`/`dispose()`
- `hooks.ts` — console/error·rejection/fetch/XHR/navigation 훅. 각 훅은 해제 함수를 반환
- `serialize.ts` — 예산 한계 직렬화(콘솔 훅 핫패스). 경로 선택은 실측 근거가 있다 —
  파일 상단 주석과 `scripts/bench.mjs`를 먼저 볼 것 (네이티브를 이기려 한 시도가 3배 느렸다)
- `buffer.ts` — 크래시 내성 링버퍼 (상한 초과 시 오래된 것부터, 드롭 수 유지)
- `transport.ts` — 라이브 WS (배칭 300ms, 지수 백오프 재접속, 큐 상한)
- `clipboard.ts` — 캡처 내보내기 폴백. 비보안 컨텍스트(`http://<사내 IP>`)에는
  `navigator.clipboard`가 없어 `execCommand`가 주 경로다 (rules 참조)

## 성능

`node scripts/bench.mjs` (빌드 후) — 직렬화 핫패스 비용을 재현한다. 핫패스를 건드리면
전후를 이 스크립트로 비교할 것. 번들 예산(gzip 4KB)은 `tests/bundle-size.test.ts`가 지킨다.

## 테스트

jsdom 환경. 훅이 원본 동작을 보존하는지 + dispose 후 원복되는지가 핵심 회귀 지점이다.
