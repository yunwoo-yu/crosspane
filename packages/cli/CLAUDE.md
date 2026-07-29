# packages/cli

허브 서버 + CLI. 대시보드 dist를 번들해 단일 npm 패키지로 배포한다.

## 모듈 맵

- `index.ts` — 엔트리: 옵션 파싱 → 허브 기동 → LAN 주소 안내 → 종료 처리
- `args.ts` — 플래그 파싱 + HELP_TEXT + cliVersion
- `server.ts` — `/agent` 수신(등록·이벤트), `/ws` 중계, 세션 레지스트리·히스토리,
  `GET /capture/:id`(라이브 세션 → 캡처 파일. 허브가 원본 이벤트를 갖고 있으므로
  대시보드가 표시용 엔트리를 역변환하는 것보다 정확하다)
- `static.ts` — 대시보드 정적 서빙 (경로 탈출 방어, SPA 폴백)
- `protocol.ts` — `@crosspane/protocol` 재수출 (소비자 import 경로 유지용)

## 보안 불변식

- 기본 바인딩은 `127.0.0.1` — LAN 노출은 `--host` 옵트인 (세션 로그가 흐르는 채널)
- 대시보드 WS는 Origin 검증(CSWSH 차단), 에이전트 메시지는 크기 상한 + 세션 위조 검사

## 테스트

`tests/`는 실제 WS 서버를 띄워 검증한다 (브라우저 불필요). 실기동은 루트 `pnpm smoke`.
