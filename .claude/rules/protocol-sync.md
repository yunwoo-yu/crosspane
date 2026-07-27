---
paths:
  - "packages/cli/src/protocol.ts"
  - "packages/dashboard/src/types.ts"
  - "packages/dashboard/src/constants.ts"
---

# 프로토콜 동기화 (건드리면 안 되는 것)

`packages/cli/src/protocol.ts` ↔ `packages/dashboard/src/types.ts`는 **수동 미러**다.
컴파일러가 드리프트를 잡지 못하므로 한쪽만 수정하면 런타임에서 조용히 깨진다.

## 양쪽을 반드시 같이 수정해야 하는 것

- `EngineName` / `ENGINE_NAMES_BY_CODE` / (cli의) `ENGINE_CODES`
- `ServerEvent` / `ClientCommand` 유니온의 모든 variant
- `HelloEvent` 필드 (`viewOnlyEngines` 등)
- `FRAME_HEADER_BYTES` — dashboard 디코더의 오프셋과 일치해야 함

## 불변 규약

- 프레임 패킷: `[엔진코드 u8][scrollY int32LE][JPEG]`. scrollY 미상은 음수(-1)
- **기존 엔진의 코드 번호를 재배열하지 말 것** — 새 엔진은 뒤에 추가만
- 헤더 크기 변경 시: 양쪽 수정 + `pnpm smoke`로 실기동 검증 필수

## 새 엔진(pane) 추가 체크리스트

1. cli `protocol.ts`: EngineName/ENGINE_CODES/ENGINE_NAMES_BY_CODE
2. dashboard `types.ts`(미러) + `constants.ts`의 ENGINE_LABEL
3. `InputTarget` 구현, 입력 불가면 hello `viewOnlyEngines`에 추가
4. `index.ts` 기동 + 가용성 안내 메시지
