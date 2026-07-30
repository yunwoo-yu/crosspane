---
paths:
  - packages/protocol/**
  - packages/agent/src/**
  - packages/cli/src/server.ts
  - packages/dashboard/src/event-log.ts
  - packages/dashboard/src/capture-file.ts
---

# 프로토콜 단일 소스 규칙

`packages/protocol/src/index.ts`가 **유일한** 프로토콜 정의다.
세 소비자(에이전트 SDK, 허브 서버, 대시보드)가 모두 직접 import한다 —
패키지별 미러 타입을 만들지 말 것.

## 불변 규약

- **런타임 코드 금지**: 타입과 순수 상수만. 에이전트가 번들에 싣기 때문에
  프로토콜 파일이 커지면 그대로 앱 번들 크기가 된다. Node 전용 API도 금지
- **이벤트 모양은 끝까지 동일하다**: 에이전트가 만든 `SessionEvent`가 서버를
  그대로 통과해 대시보드와 `.crosspane.json`에 들어간다. 중간 변환 계층을
  만들지 말 것 — 라이브와 리플레이가 같은 패널 코드를 쓰는 근거가 여기다
- **모든 이벤트에 `sessionId` 필수**: 캡처 파일이 단독으로 해석 가능해야 한다
- **캡처 파일은 버전 필드로 게이트**: `version: 1`이 아니면 거부(`parseCaptureFile`).
  이벤트 필드를 추가하는 것은 하위호환이지만, 의미를 바꾸면 버전을 올릴 것

## 새 이벤트 타입 추가 체크리스트

1. `packages/protocol`: `SessionEvent` 유니온에 추가
2. `packages/agent/src/hooks.ts`: 훅에서 생성 (원본 동작 보존 + 해제 함수 반환)
3. `packages/dashboard/src/event-log.ts`: `logEntryFromEvent` 또는
   `networkEntryFromEvent`에 매핑 (둘 다 아니면 표시 안 됨)
4. 서버는 수정 불필요 — 중계만 한다 (세션 위조 검사만 존재)

## 접속 직후 답하는 소비자는 재생 완료를 기다려야 한다

허브는 `hello` 뒤에 히스토리를 **여러 프레임으로** 흘린다. 라이브 UI는 몇 프레임 늦게
채워져도 무해하지만, `crosspane mcp`처럼 접속 직후 질문에 답하는 소비자는 그 사이에
답하면 **부분 히스토리로 답한다** — 코딩 에이전트가 "에러 없음"이라 오답할 수 있다는 뜻이고,
CI에서 플레이크로 먼저 드러났다(macOS 레그에서 이벤트 2건 중 1건만 보임).

그래서 재생 끝에 `history-complete`를 보낸다. **접속당 하나**이고 데이터가 아니다.
- 새 소비자가 접속 직후 질의에 답한다면 이 신호까지 기다릴 것 (`packages/cli/src/mcp/index.ts`)
- 순차 프레임을 단정하는 테스트는 이 신호를 흐름에서 빼야 한다 — 넣으면 모든 단정이
  하나씩 밀린다 (`TestDashboard`가 그렇게 한다)
- 지우지 말 것: 조용히 잘린 답을 주지 않기 위한 경계다
