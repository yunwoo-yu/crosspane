---
paths:
  - "packages/cli/src/protocol.ts"
  - "packages/cli/src/frame-packet.ts"
  - "packages/dashboard/src/types.ts"
  - "packages/dashboard/src/constants.ts"
---

# 프로토콜 단일 소스 규칙

`packages/cli/src/protocol.ts`가 **유일한** 프로토콜 정의다.
대시보드는 vite alias + tsconfig paths(`crosspane/protocol`)로 이 파일을 직접 참조한다
— 수동 미러를 되살리지 말 것.

## 불변 규약

- `protocol.ts`는 **isomorphic**이어야 한다 — 브라우저가 직접 번들하므로
  Node 전용 API(Buffer, fs 등) 추가 금지. 인코더는 `frame-packet.ts`(Node 전용)
- 프레임 패킷: `[엔진코드 u8][scrollY int32LE][JPEG]`. scrollY 미상은 음수(-1)
- **기존 엔진의 코드 번호를 재배열하지 말 것** — 새 엔진은 뒤에 추가만
- `FRAME_HEADER_BYTES` 변경 시 `pnpm smoke`로 실기동 검증 필수

## 새 엔진(pane) 추가 체크리스트

1. `protocol.ts`: EngineName / ENGINE_CODES / ENGINE_NAMES_BY_CODE (뒤에 추가)
2. dashboard `constants.ts`: ENGINE_LABEL 항목
3. `InputTarget` 구현, 입력 불가면 hello `viewOnlyEngines`에 추가
4. `index.ts` 기동 + 가용성 안내 메시지
