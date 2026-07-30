# packages/dashboard

허브에 접속해 라이브 세션을 보여주고, `.crosspane.json` 캡처 파일을 리플레이한다.

## 모듈 맵

- `hooks/useCrosspaneSocket.ts` — WS 연결/자동 재접속 + 조립 (로직은 아래 모듈에)
- `event-log.ts` — 이벤트 → 세션 상태/로그/네트워크 엔트리 (순수 함수)
- `capture-file.ts` — 캡처 파일 파싱 → 라이브와 **같은 엔트리 모양** (패널 코드 공유)
- `hooks/useEventBatcher.ts` — 로그 폭주 시 리렌더 상한 (EVENT_BATCH_MS)
- `log-utils.ts` / `network-utils.ts` — 패널의 필터·검색 순수 로직.
  **패널 테스트에서 중복 검증하지 말 것** (`.claude/rules/testing-jsdom.md`)
- `screen-events.ts` — 화면 이벤트 다루기 (체크포인트 인식 트리밍)
- `hub-token.ts` — `?t=` 접속 토큰을 sessionStorage에 넣고 주소창에서 지운다.
  `withHubToken()`이 fetch·WS 주소에 다시 붙인다 — 노출된 허브는 토큰 없이 401이다
- `constants.ts` — 렌더·배칭 상한 (근거는 `.claude/rules/dashboard-render-window.md`)
- `components/` — SessionList / ConsolePanel / NetworkPanel / ScreenPanel
- `components/ConnectHint.tsx` — 빈 상태의 "여기로 붙여라" 스니펫.
  포트·LAN 주소는 `GET /hub-info`에서 받는다 — 하드코딩하면 포트 폴백 시
  잘못된 값을 안내해 세션이 사라진다(실측)
- `components/ui/` — shadcn 스타일 기본 컴포넌트. **새 UI는 반드시 이걸로**
- `lib/cn.ts` — clsx + tailwind-merge. 스타일은 Tailwind 유틸리티(@theme 토큰)

## 불변식

- 라이브와 리플레이는 **같은 패널을 쓴다** — 변환은 capture-file.ts에서만
- `hello`는 세션 경계다 — 서버가 재접속마다 히스토리를 전량 재생하므로
  hello 수신 시 배칭 버퍼를 비우지 않으면 로그가 중복 누적된다 (실측 버그)
- 좀비 소켓 가드: 이전 소켓의 늦은 close/message가 새 소켓 상태를 덮어쓰지 않게
  `socketRef.current !== socket` 검사 유지
- **app.css에 unlayered 전역 규칙을 넣지 말 것** — Tailwind v4는 유틸리티를 @layer에
  두므로 레이어 밖 규칙이 모든 p-*/m-*를 무효화한다 (실측)

## 테스트

jsdom 제약은 `.claude/rules/testing-jsdom.md` 참조 (에이전트와 공용).
