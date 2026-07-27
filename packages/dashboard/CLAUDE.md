# packages/dashboard

## 모듈 맵

- `hooks/useCrosspaneSocket.ts` — WS 연결/자동 재접속, 이벤트→상태, 바이너리 프레임
  디코드 → 구독자 디스패치 허브 (`subscribeToFrames`)
- `components/EnginePane.tsx` — canvas 렌더링 + 로컬 에코(스크롤 예측) + 클릭/휠/키 캡처
- `components/Toolbar.tsx` — back/forward/reload, URL 어긋남 재동기화 버튼
- `components/ConsolePanel.tsx` — 엔진 필터 + 내비게이션 구분선 타임라인
- `log-utils.ts` — 배지 카운트/desync 감지/URL 표시용 순수 함수
- `types.ts` — 프로토콜은 `crosspane/protocol`(cli 단일 소스) 재수출 + UI 전용 타입

## 불변 규칙 위치

세부 규칙은 path-scoped로 자동 로드된다 (`.claude/rules/`):

- 렌더링/입력/로컬 에코 → `.claude/rules/dashboard/frame-rendering.md`
- 테스트(jsdom 제약) → `.claude/rules/dashboard/testing-jsdom.md`
