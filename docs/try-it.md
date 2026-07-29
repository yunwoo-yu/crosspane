# 직접 확인해보기

crosspane을 손으로 만져보는 절차. 위에서 아래로 갈수록 실제 사용 환경에 가까워진다.
각 단계는 앞 단계 없이도 독립적으로 된다.

준비: `pnpm install && pnpm build` (한 번)

---

## 1. 5분 — 대시보드에 로그가 흐르는지 (기기 불필요)

```bash
node packages/cli/dist/index.js          # 허브 + 대시보드 :7788 (브라우저가 열린다)
node examples/demo/serve.mjs             # 데모 페이지 :7999 (다른 터미널에서)
```

브라우저에서 <http://localhost:7999> 를 열고 버튼을 눌러본다.

확인할 것:

- 대시보드 Console 탭에 로그·경고·예외가 **누른 즉시** 나타난다
- `fetch → 404`와 `fetch → network failure`가 Network 탭에 뜨고, 실패는 `status 0`으로
  구분된다 (웹뷰에서 가장 안 보이는 실패다)
- `throw an uncaught error`가 스택과 함께 잡힌다
- `pushState`를 누르면 Console에 내비게이션 구분선이 들어가 로그가 화면 단위로 묶인다
- 세션 목록에서 라벨(`crosspane demo page`)과 플랫폼(`Browser`)이 보인다

## 2. 화면 기록 재생

데모 페이지에서 `● start screen recording` → 몇 번 클릭·스크롤 → `■ stop`.

대시보드 **Screen 탭**에서 방금 조작이 재생된다. 재생 컨트롤(속도·타임라인)이 붙어 있고,
같은 세션의 로그와 같은 타임라인에 있다.

## 3. 캡처 파일 왕복 (오프라인 경로 — 잠금 환경의 주력)

두 방향 모두 같은 파일 포맷이고, 같은 화면으로 재생된다.

- **에이전트 쪽에서 내보내기**: 데모의 `⤓ export capture file` → `.crosspane.json`이 받아진다
- **허브 쪽에서 저장**: 라이브 세션을 고른 상태에서 대시보드 상단의 `⤓ Save session`
  (허브가 원본 이벤트로 만든다 — 표시용 엔트리를 역변환하지 않아 무손실이다)

받은 파일을 대시보드 화면에 **드래그 앤 드롭**하거나 상단 `Open capture…`로 열면
라이브와 동일한 UI로 재생된다. (허브 연결 없이도 된다 — 다른 사람이 보내준 파일을 여는 경로다)

`⧉ copy capture to clipboard`도 눌러본다. 다운로드가 막힌 웹뷰를 위한 경로이고,
결과가 버튼 아래에 표시된다.

## 4. 실기기 — 폰의 웹뷰/인앱브라우저 (이 툴의 존재 이유)

```bash
node packages/cli/dist/index.js --host 0.0.0.0   # LAN 노출 (기본은 로컬 전용)
node examples/demo/serve.mjs
```

허브가 출력하는 `live agents → http://<사내 IP>:7788` 주소를 확인한다.

폰을 **같은 Wi-Fi**에 두고 `http://<사내 IP>:7999` 를 연다:

- 폰의 기본 브라우저
- **카카오톡·인스타그램 등에 링크를 보내 인앱브라우저로 열기** ← 이게 핵심 시나리오다.
  `chrome://inspect`로는 아무것도 안 보이는 자리에서 대시보드에 로그가 흐른다
- 세션 목록의 platform이 `In-app browser` / `Android WebView` 등으로 잡히는지 확인

폰에서 버튼을 누르면 맥의 대시보드에 실시간으로 뜬다. 여러 기기를 동시에 붙여도 세션이
분리돼 보인다.

> 안 보이면: 방화벽(맥 시스템 설정 → 네트워크 → 방화벽)과 같은 Wi-Fi인지, 그리고
> `--host 0.0.0.0`을 줬는지 확인. 사내망에서 클라이언트 격리가 걸려 있으면 안 된다.

## 5. 코딩 에이전트로 물어보기 (MCP)

허브를 띄운 상태에서, Claude Code 설정에 등록한다:

```json
{ "mcpServers": { "crosspane": { "command": "node", "args": ["<repo>/packages/cli/dist/index.js", "mcp"] } } }
```

(배포본을 쓸 때는 `{ "command": "crosspane", "args": ["mcp"] }`)

데모 페이지에서 에러를 몇 개 만든 뒤 물어본다:

> "지금 붙어 있는 웹뷰 세션에서 뭐가 실패했어?"

에이전트가 `list_sessions` → `get_errors`를 스스로 불러 스택과 실패 요청을 읽는다.
대시보드를 열어 읽고 옮겨 적는 왕복이 사라지는 게 요점이다.

명령줄에서 직접 확인하려면:

```bash
printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_errors"}}' \
  | node packages/cli/dist/index.js mcp
```

## 6. 앱에 직접 붙여보기

번들러가 있으면:

```ts
import { initCrosspane } from '@crosspane/agent'
initCrosspane({ label: '결제 웹뷰', serverUrl: 'http://<사내 IP>:7788' })
```

번들러가 없거나 스크립트 태그만 쓸 수 있으면 —
`packages/agent/dist/crosspane-agent.global.js`(약 3KB gzip)를 앱에서 서빙하고:

```html
<script src="/crosspane-agent.global.js"></script>
<script>window.crosspane.initCrosspane({ label: 'kiosk' })</script>
```

(`globalName`은 `crosspane`이다. ESM만 필요하면 같은 폴더의 `.esm.js`를 쓴다 —
데모가 `/agent.js`로 서빙하는 것이 그쪽이다)

`serverUrl`을 빼면 오프라인 전용(캡처 파일)으로 동작한다.

---

## 아직 안 되는 것 (기대치 정렬)

- **브레이크포인트·DOM 검사·프로파일링** — JS는 자기 자신을 멈출 수 없다.
  진짜 인스펙터가 붙는 환경이면 그걸 쓰는 게 맞다
- **`initCrosspane` 호출 이전의 오류** — 부트 실패나 파스 에러는 잡히지 않는다
- **허브를 막는 엄격한 CSP** — 단일 파일 번들로 `script-src`는 피하지만,
  라이브 모드는 `connect-src`가 허용돼야 한다
