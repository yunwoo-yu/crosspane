---
paths:
  - "packages/dashboard/src/components/ConsolePanel.tsx"
  - "packages/dashboard/src/components/NetworkPanel.tsx"
  - "packages/dashboard/src/capture-file.ts"
---

# 대시보드 렌더 상한

## 라이브와 리플레이는 상한 성질이 다르다

- **라이브**: `useEventBatcher`가 상태 자체를 상한(MAX_LOGS 500 / MAX_NETWORK_ENTRIES 800)으로
  자른다. 실측상 4000 events/sec에서도 p99 26ms로 여유가 있다 — 가상화를 도입하지 말 것
- **리플레이**: 캡처 파일은 **자르지 않는다**. 다른 사람이 보낸 세션 전체를 봐야 하기 때문이다.
  대신 **렌더만** 상한한다

## 렌더 상한이 없으면 브라우저가 멈춘다 (실측)

10만 이벤트 캡처(12.5MB)를 그대로 그렸을 때: DOM 40만 노드, heap 170MB, 필터 조작에
669ms 멈춘 프레임. 상한 적용 후: DOM 2044 노드, heap 17MB.

규칙:
- 필터링된 목록의 **뒤쪽**(최신 = 실패 직전)을 상한만큼만 렌더한다
- 데이터는 전부 state에 유지한다 — 필터·검색이 숨은 엔트리에 도달할 수 있어야 한다
  (실측 확인: 좁히는 검색어로 앞쪽 엔트리가 나온다)
- **숨긴 건수를 화면에 밝힌다** — 조용히 자르면 "이게 전부"로 오도한다.
  crosspane의 다른 상한들(텍스트 잘림, repeat 합치기, 링버퍼 드롭)과 같은 원칙이다

## 캡처 파싱 시점의 처리

`capture-file.ts`는 라이브와 같은 규칙을 적용한다:
- 연속 중복 로그를 `mergeRepeatedLog`로 합친다 (구버전 에이전트 파일 대비)
- 화면 이벤트는 `trimScreenEvents`로 상한 — **반드시 재생 체크포인트에서만** 자른다
