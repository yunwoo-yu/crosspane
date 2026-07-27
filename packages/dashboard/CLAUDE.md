# packages/dashboard

## 모듈 맵

- `hooks/useCrosspaneSocket.ts` — WS 연결/자동 재접속, 이벤트→상태, 바이너리 프레임 디코드 →
  구독자 디스패치 허브 (`subscribeToFrames`)
- `components/EnginePane.tsx` — canvas 렌더링 + 로컬 에코(스크롤 예측) + 클릭/휠/키 캡처
- `components/Toolbar.tsx` — back/forward/reload, URL 어긋남 재동기화 버튼
- `components/ConsolePanel.tsx` — 엔진 필터 + 내비게이션 구분선 타임라인
- `log-utils.ts` — 배지 카운트(마지막 내비게이션 이후), desync 감지, URL 표시용 순수 함수
- `types.ts` — **cli `protocol.ts`의 수동 미러** (변경 시 반드시 양쪽)

## 원칙

- 프레임은 `subscribeToFrames` → canvas 직접 드로우. **React 상태에 절대 넣지 않는다** (리렌더 비용)
- 로컬 에코: `localTarget − frameScrollY` 차이만 transform 유지 — 프레임 도착 시 무조건 리셋하면
  고무줄 현상이 난다 (EnginePane 주석 참조)
- wheel은 non-passive 네이티브 리스너로 붙인다 — React `onWheel`은 passive라 preventDefault 불가
- view-only pane(입력 미러링 불가)은 입력 핸들러를 붙이지 않고 desync 판단에서도 제외

## 테스트 (jsdom 제약)

- `PointerEvent` 없음 → MouseEvent로 대체 스텁, `scrollIntoView` 없음 → vi.fn() 스텁
- testing-library auto-cleanup은 vitest `globals: true`가 있어야 동작 (vite.config.ts)
- 프레임 주입은 `subscribeToFrames`를 가짜로 넘겨 리스너를 캡처하는 패턴 사용 (components.test 참조)
