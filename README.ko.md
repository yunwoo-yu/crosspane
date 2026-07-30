# crosspane

<a href="https://github.com/yunwoo-yu/crosspane/blob/main/README.md">English</a>

<p>
  <a href="https://www.npmjs.com/package/crosspane"><img alt="npm version" src="https://img.shields.io/npm/v/crosspane.svg?color=cb3837"></a>
  <a href="https://github.com/yunwoo-yu/crosspane/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/yunwoo-yu/crosspane/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/yunwoo-yu/crosspane/blob/main/LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
</p>

**개발자도구가 닿지 않는 웹 화면을 디버깅합니다.**

인앱 웹뷰, 인앱브라우저(카카오톡·인스타그램·라인), 키오스크, TV, 보안 잠금 빌드 —
`chrome://inspect`에 아무것도 안 뜨고 Safari의 개발자용 메뉴가 비어 있는 자리입니다.
crosspane은 그 화면에 콘솔과 네트워크 로그, 그리고 남에게 건넬 수 있는 캡처 파일을 줍니다.

> **⚠️ 베타** — 1.0 전까지는 마이너 버전 사이에 API와 CLI 플래그가 바뀔 수 있습니다.
> 버그 제보와 피드백을 환영합니다 — [이슈를 열어 주세요](https://github.com/yunwoo-yu/crosspane/issues).

![웹뷰의 콘솔·네트워크 이벤트가 crosspane 대시보드에 실시간으로 도착하는 모습](https://raw.githubusercontent.com/yunwoo-yu/crosspane/main/docs/images/demo.gif)

---

## 어떻게 동작하나

**제품의 본체는 서버가 아니라 페이지에 넣는 에이전트입니다.**

디버거를 붙이는 방식은 앱이 허락해야 동작합니다. iOS 16.4+는 `isInspectable`,
안드로이드는 `setWebContentsDebuggingEnabled`를 앱이 켠 웹뷰만 노출하고, 릴리스 빌드는
꺼져 있으며, 보안 솔루션(ISMS-P 대응 빌드 등)은 디버거가 붙는 순간 앱을 죽입니다.

그 환경에서 남는 유일한 통로는 **앱이 스스로 품고 나가는 계측**입니다. crosspane의
에이전트는 페이지 안에서 `console`·`fetch`·XHR·라우팅을 관찰해 여러분의 허브로 보냅니다.
네트워크가 아예 없으면 파일로 꺼냅니다.

## 빠른 시작

**1. 허브 실행**

```bash
npx crosspane                  # 대시보드 http://localhost:7788
```

어디를 봐야 하는지, 그리고 페이지가 붙으면 무엇이 흐르고 있는지 터미널이 알려줍니다:

```
crosspane dashboard → http://localhost:7788
● session · 결제 웹뷰  https://staging.example.com/pay
```

대시보드를 열지 않아도 페이지가 허브를 찾았는지 알 수 있습니다 — 아무것도 안 뜰 때
가장 알고 싶은 것이 그것입니다. 대시보드는 브라우저 언어를 따라 한국어나 영어로 뜨고,
헤더에서 바꿀 수 있습니다.

**2. 앱에 에이전트 추가** (개발·QA 빌드에만 — [안전하게 쓰기](#안전하게-쓰기) 참조)

```bash
npm install @crosspane/agent
```

```ts
import { initCrosspane } from '@crosspane/agent'

const agent = initCrosspane({ label: '결제 웹뷰' })

// 오프라인: 디버그 제스처나 숨은 QA 메뉴에 연결하세요.
// 웹뷰에서는 copyCapture()를 우선하세요 — 다운로드가 안 되는 경우가 많습니다
agent.exportFile()   // <label>.crosspane.json 다운로드
```

localhost는 이게 전부입니다 — 에이전트가 허브를 스스로 찾습니다. 주소도, 토큰도,
설정도 없습니다. `agent.live`로 실제로 흐르고 있는지 확인할 수 있습니다.

번들러가 없다면 단일 파일 빌드(gzip 약 4KB)를 script 태그로 불러오세요 —
[에이전트 README](https://github.com/yunwoo-yu/crosspane/tree/main/packages/agent#without-a-bundler).

**3. 버그를 재현하세요.** 콘솔 로그, 잡히지 않은 에러, 처리되지 않은 프로미스 거부,
실패한 요청, 화면 이동이 대시보드에 — 또는 내보낸 파일에 — 나타납니다.

### 어떤 환경이든 설정은 하나

localhost든, 같은 Wi-Fi의 폰이든, 배포된 스테이징 URL이든, 프로덕션이든 다른 것은
**페이지가 허브에 닿는 방법** 하나뿐입니다. 그 하나를 주소로 넘기면 나머지는 같습니다.

```ts
initCrosspane({
  label: '결제 웹뷰',
  serverUrl: process.env.NEXT_PUBLIC_CROSSPANE_URL,  // Vite: import.meta.env.VITE_CROSSPANE_URL
})
```

```
NEXT_PUBLIC_CROSSPANE_URL=https://crosspane.example.com
```

다른 BASE_URL처럼 **그냥 주소만** 넣습니다. 뒤에 붙일 것이 없고, 프로덕션을 포함한
모든 환경에서 같은 값이면 됩니다. 세션을 **보내는** 데는 자격증명이 필요 없고,
**읽는** 데는 여러분 머신을 떠나지 않는 토큰이 필요합니다 — 그래서 누구나 읽을 수 있는
페이지 소스에 이 주소가 있어도 아무것도 새지 않습니다.

**배포된 페이지를 폰에서 보려면 — 플래그 하나:**

```bash
crosspane --lan-tls
```

허브가 `https://<대시로-바꾼-LAN-IP>.local-ip.sh:7788`을 기기가 이미 신뢰하는 인증서로
서빙하므로, 같은 Wi-Fi의 `https://` 페이지가 여러분 노트북에 닿습니다. 위 환경변수에
그 주소를 넣으세요. **터널도, 계정도, 기기에 설치할 것도 없습니다** — 실제 안드로이드
폰에서 배포된 사이트로 확인했고 권한 팝업도 뜨지 않았습니다.

Wi-Fi 밖 어디서든 닿아야 한다면(팀원의 네트워크, CI, 다른 망의 기기) 터널을 쓰세요:

```bash
crosspane --tunnel --write-env
```

설치돼 있는 `cloudflared`나 `ngrok`으로 터널을 띄우고 그 주소를 알린 뒤 `.env.local`에
적어 줍니다. 허브를 끄면 터널과 env 항목도 함께 사라집니다. 세션 로그가 터널 제공자를
거치므로 명시적인 플래그이며, **crosspane은 바이너리를 대신 내려받지 않습니다.**

배포된 앱은 주소가 배포 설정에 들어가므로 바뀌면 안 됩니다. 호스트명을 주면 영구
터널까지 만들어 줍니다:

```bash
cloudflared tunnel login                                  # 최초 1회, 브라우저가 열립니다
crosspane --tunnel --hostname crosspane.example.com       # 매일 이 명령 (멱등)
```

### 누가 실제로 보내는가

기본적으로 그 주소를 가진 모든 설치본이 보냅니다. 개발·QA 빌드에서는 그게 맞습니다.
같은 빌드가 로그를 받고 싶지 않은 사람들에게도 간다면, 앱이 이미 아는 것으로 막으세요 —
`enabled: false`면 에이전트는 **훅을 아예 설치하지 않습니다**:

```ts
initCrosspane({ serverUrl: HUB, enabled: () => user.isQA })
```

기능 플래그, 사내 계정 확인, 숨은 디버그 메뉴의 토글 — 무엇이든 됩니다. **앱이 스스로
여는 웹뷰**에는 이 방식이 맞습니다(이 툴이 존재하는 이유의 대부분입니다). 그런 웹뷰에는
주소창이 없어서 URL 기반의 어떤 방법도 통하지 않기 때문입니다.

### `--lan-tls`를 믿기 전에 알아둘 것

- **기기가 한 번 묻습니다.** 크롬은 로컬 네트워크 접근 권한을 묻습니다 — 허용하세요.
  **인앱 웹뷰**가 그 팝업을 띄우는지는 확인되지 않았습니다. 바로 그 환경이 이 툴이
  존재하는 이유이므로, 여러분의 앱에서 직접 해 보기 전까지는 미지수로 두세요.
- **어떤 네트워크는 이름을 해석하지 않습니다.** 사내 리졸버와 상당수 공유기가 사설
  주소를 가리키는 공개 DNS 응답을 버립니다(DNS rebinding 방어). crosspane이 기동 시에
  확인해서, 조용히 실패하는 대신 이유를 알려줍니다.
- **인증서의 개인키는 공개돼 있습니다** — `*.local-ip.sh`가 동작하는 방식이고, 내 것이
  아닌 주소에 신뢰된 인증서를 붙이는 유일한 길입니다. 즉 이건 *신뢰*를 사는 것이지
  *기밀성*을 사는 게 아닙니다: 같은 Wi-Fi의 누군가는 복호화할 수 있습니다. 다만 이것이
  대체하는 것은 평문 HTTP이고(어차피 읽힙니다), 세션을 **읽는** 데는 여전히 `?t=`
  토큰이 필요합니다. 그게 문제되는 망이라면 직접 만든 인증서나 터널을 쓰세요.
- **`local-ip.sh`가 살아 있어야 합니다** (DNS와 인증서 모두. 인증서는 한 번 받아
  만료 1주일 전까지 캐시합니다).

**자체 서명 인증서는 앱 웹뷰에서 동작하지 않습니다** — 안드로이드 7부터 앱은 사용자가
설치한 CA를 신뢰하지 않습니다. crosspane이 인증서를 받기만 하고 만들지는 않는 이유입니다.

## 무엇을 얻나

- **콘솔** — 인자 직렬화가 된 `console.*`, 스택이 있는 잡히지 않은 에러, 처리되지 않은
  프로미스 거부. 레벨 필터·검색·자동 따라가기
- **네트워크** — fetch와 XHR의 상태·소요시간·실패 (`status 0` = 차단 또는 오프라인,
  웹뷰에서 보이지 않던 바로 그것). 응답 본문 미리보기는 선택
- **화면 이동 타임라인** — SPA 라우트 변경 포함. 로그가 화면 단위로 묶입니다
- **세션 목록** — 여러 기기를 동시에, 각각 라벨·라이브/종료 상태·에러 배지와 함께
- **저장과 재생** — 지금 보고 있는 세션을 `.crosspane.json`으로 저장하거나, 남이 보낸
  파일을 대시보드에 끌어다 놓으세요. 어느 쪽이든 UI가 같습니다
- **화면 기록** (선택) — `@crosspane/agent-replay`를 추가하면 DOM을 기록해 Screen 탭에서
  로그와 같은 타임라인으로 재생합니다
- **MCP 서버** — `crosspane mcp`로 코딩 에이전트가 세션을 직접 읽습니다. 대시보드에서
  로그를 복사하는 대신 "결제 웹뷰가 왜 실패했어?"라고 물으면 됩니다
- **한국어·영어** — 대시보드가 브라우저 언어를 따르고 헤더에서 바꿀 수 있습니다. 선택은
  기억됩니다

## 안전하게 쓰기

crosspane은 콘솔 출력과 요청 메타데이터를 수집합니다. 디버그 빌드 기능으로 다루세요:

```ts
// 게이트를 걸고 켜 두기 — 프로덕션에서만 나는 버그를 디버깅할 수 있는 이유입니다
initCrosspane({ serverUrl: HUB, enabled: isDebugActivated })

// 스토어 빌드에서 아예 빼려면
if (process.env.NODE_ENV !== 'production') {
  const { initCrosspane } = await import('@crosspane/agent')
  initCrosspane({ label: '결제 웹뷰' })
}
```

- `enabled: false`는 **훅을 아예 설치하지 않습니다** — `console`/`fetch`/XHR이 그대로라
  옵트인하지 않은 방문자는 영향을 받지 않습니다
- 빌드에 들어간 주소는 그냥 주소입니다: 보내는 데는 자격증명이 필요 없고, **읽는** 데는
  여러분 머신에 남는 토큰이 필요합니다 —
  [SECURITY.md](https://github.com/yunwoo-yu/crosspane/blob/main/SECURITY.md)
- 응답 본문은 `captureBodies: true`를 주지 않는 한 **수집하지 않습니다**
- 에이전트는 의존성이 없고 gzip 몇 KB입니다

## CLI

```
crosspane [options]

--port <n>     대시보드 포트 (기본 7788. 기본 포트는 점유 시 +1로 물러나고,
               명시한 포트는 물러나지 않습니다)
--host <addr>  바인드 주소 (기본 127.0.0.1 — 로컬 전용. 네트워크의 폰·기기에서
               세션을 받으려면 0.0.0.0)
--lan-tls      기기가 이미 신뢰하는 인증서로 LAN을 https/wss로 엽니다. 같은 Wi-Fi의
               배포된 https:// 페이지가 닿습니다. --host 0.0.0.0을 함의합니다
--tunnel       설치된 cloudflared나 ngrok으로 터널을 띄우고 그 주소를 알립니다.
               세션 로그가 그 제공자를 거칩니다. 바이너리를 대신 내려받지 않습니다
--hostname <name>
               일회용 대신 영구 주소. --tunnel과 함께면 named 터널을 만들고
               DNS까지 연결합니다 (멱등)
--tls-cert <file> / --tls-key <file>
               직접 준비한 인증서로 https/wss 서빙
--public-url <url>
               LAN 주소 대신 이 주소를 알립니다 (터널·리버스 프록시 뒤일 때).
               한 번 주면 기억합니다
--write-env [file]
               허브 주소를 env 파일(기본 .env.local)에 적어 에이전트에 아무 인자도
               필요 없게 합니다. 허브가 멈추면 지웁니다
--ingest-key <key>
               보내는 쪽에 ?k=<키>도 요구합니다. 기본은 꺼짐 — 주소만으로 충분하게
--no-auth      허브 노출 시 붙는 읽기 토큰을 끕니다 — 완전히 신뢰하는 망에서만
--no-open      대시보드를 자동으로 열지 않습니다
--verbose      진단 로깅 — 버그 리포트에 첨부하세요
-v, --version  버전 출력
-h, --help     도움말
```

허브를 노출하면 자격증명이 **두 개** 생기고, 그 차이가 중요합니다. **쓰기 전용 인제스트
키**(`?k=`)는 누구나 소스를 볼 수 있는 배포 페이지에 있어도 안전하고, **읽기
토큰**(`?t=`)은 대시보드 URL에만 있어야 합니다. crosspane은 앱에 넣으라고 안내하는
주소에 읽기 토큰을 절대 담지 않습니다.

허브가 도는 동안 세션이 붙고 끊길 때마다 페이지 URL과 함께 출력합니다 — "앱이 허브에
못 닿는 것"과 "앱이 그 코드를 안 돌리는 것"을 아무것도 열지 않고 구분할 수 있습니다.

## 코딩 에이전트에게 물어보기 (MCP)

`crosspane mcp`는 돌고 있는 허브의 세션을 Model Context Protocol로 노출합니다.
Claude Code 같은 코딩 에이전트가 직접 읽습니다.

```json
{
  "mcpServers": {
    "crosspane": { "command": "npx", "args": ["-y", "crosspane", "mcp"] }
  }
}
```

허브를 띄우고 기기를 붙인 뒤 평범한 말로 물어보세요 — *"결제 웹뷰가 왜 실패했어?"*
에이전트가 세션·에러·네트워크·타임라인을 직접 조회합니다.

## 잠긴 기기에서 캡처 꺼내기

네트워크가 아예 없거나 허브에 닿을 수 없는 환경에서는 파일이 유일한 경로입니다.

```ts
const ok = await agent.copyCapture()   // 클립보드로 (boolean 반환)
agent.exportFile()                     // 다운로드
```

`copyCapture()`가 `false`를 돌려주면 그 환경에서 복사가 막힌 것입니다 — 실패를 숨기지
않습니다. `http://<사내 IP>`처럼 보안 컨텍스트가 아닌 곳에서는 `navigator.clipboard`가
아예 없어서 `execCommand('copy')`가 주 경로가 됩니다.

받은 파일은 대시보드에 끌어다 놓으면 라이브와 **똑같은 UI**로 재생됩니다.

---

더 자세한 배경과 설계 근거는 [영어 README](https://github.com/yunwoo-yu/crosspane/blob/main/README.md),
[ARCHITECTURE.md](https://github.com/yunwoo-yu/crosspane/blob/main/ARCHITECTURE.md), [docs/decisions.md](https://github.com/yunwoo-yu/crosspane/blob/main/docs/decisions.md)에 있습니다.
이 문서는 영어판보다 짧습니다 — 두 문서가 어긋나면 영어판이 기준입니다.

## 라이선스

MIT
