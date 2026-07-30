# @crosspane/protocol

## 0.7.0

### Minor Changes

- f872e29: 디버깅은 렌더링일 수도, 이벤트일 수도, 요청일 수도 있다 — 이제 셋 다 보인다.

  - **사용자 상호작용** (클릭·폼 제출·조작 키·입력). 로그와 요청만으로는 "무엇 때문에"가
    빠진다. 웹뷰에는 개발자도구가 없어 재현 절차를 물어볼 수조차 없다.
    **입력 값은 담지 않는다** — 길이만 담고, 문자 키(`key.length === 1`)도 담지 않는다.
    이어 붙이면 타이핑한 내용이 복원되고 그 순간 이 툴은 비밀번호 유출 경로가 된다
  - **렌더링·응답성 지표** (LCP · CLS · INP · FCP · TTFB · longtask). "왜 느리지"는
    개발자도구 없이는 손도 못 대던 질문이다. Web Vitals의 공개 임계값을 넘긴 것만
    경고로 올려서 정상 지표가 화면을 물들이지 않게 했다
  - **통합 타임라인 탭** (기본 화면). 개발자도구의 가장 큰 불편은 탭이 갈라져 있다는 것이다 —
    콘솔에서 에러를 보고, 네트워크로 옮겨 그 시각의 요청을 눈으로 찾고, 무엇을 눌러서
    그렇게 됐는지는 어디에도 없다. 디버깅은 대개 인과를 찾는 일이고 인과는 시간축에 있는데
    그 축이 넷으로 쪼개져 있었다. 이제 한 줄기로 읽힌다:
    `click button#pay "결제하기"` → `POST 500 /api/pay` → `결제 실패`.
    종류별 칩에 건수를 달아 열어 보기 전에 무엇이 있는지 알 수 있고, 꺼 둔 종류가 있으면
    빈 화면의 이유를 밝힌다
  - **MCP도 같이 본다** — 대시보드에만 있으면 코딩 에이전트는 재현 절차를 모른 채 추측한다.
    `get_timeline`에 `USER`/`PERF` 줄이 나오고 `list_sessions`가 상호작용 건수를 센다

  에이전트 번들 예산을 4.5 → 5.5KB gzip으로 올렸다(측정 5.0KB). 근거는
  `packages/agent/tests/bundle-size.test.ts` 상단에 남겼다 — 셋 다 편의 라이브러리가 아니라
  관측 자체이고, 브라우저가 이미 가진 것을 읽을 뿐이라 의존성은 여전히 0이다.
  **다음에 또 올리려면 옵셔널 패키지 분리를 먼저 검토할 것.**

## 0.6.0

### Minor Changes

- d47c058: 네트워크 탭이 페이지가 낸 요청을 **전부** 보여준다.

  실측: 한 페이지에서 일어난 요청 9건 중 대시보드에 보인 것은 **1건**이었다. 훅이
  `fetch`/`XMLHttpRequest`만 가로채기 때문에 이미지·CSS·동적 script·`sendBeacon`·
  `EventSource`가 통째로 빠졌고, 무엇보다 **에이전트가 설치되기 전에 나간 요청**(앱 부팅 시
  API 호출의 전형)이 사라졌다. 화면에 없으면 사용자는 "요청이 안 나갔다"로 읽는다 —
  실제로는 우리가 못 본 것이다.

  - 브라우저가 이미 기록해 둔 리소스 타이밍(`PerformanceObserver`, `buffered: true`)으로
    누락분을 메운다. 같은 페이지가 이제 9건 전부 보인다. 훅이 이미 본 요청은 시각으로
    갈라 건너뛰므로 중복이 없다
  - `status`가 **없을 수 있다** — 모르는 것과 실패한 것은 다르다. 0으로 채우면 "실패한
    요청만" 필터가 멀쩡한 이미지로 가득 찬다. 화면에는 `—`로 나오고, MCP 출력과
    `isFailedRequest`도 이를 실패로 세지 않는다
  - **필터에 가려진 건수를 항상 표시한다** — 목록에 몇 줄이라도 있으면 사용자는 그것을
    "전부"로 읽는다. 누르면 필터가 풀린다
  - 요청을 낸 주체(`fetch`/`xhr`/`img`/`css`/`script`/`beacon`)를 열로 보여주고,
    리소스 타이밍으로 관측된 줄은 정보가 적은 이유를 상세에 밝힌다
  - URL 열이 남은 폭을 갖는다 (가장 중요한 열이 `/late-f…`로 잘리고 있었다)

  에이전트 번들은 gzip 4.3KB로, 예산 4.5KB 안이다.

## 0.5.0

### Minor Changes

- 462e3cf: Signal the end of history replay, so `crosspane mcp` stops answering from a partial one

  The hub sends `hello` and then streams history across several frames. A live UI filling in a few
  frames late is harmless, but `crosspane mcp` answers a question immediately after connecting, and
  between those frames it was answering from **part** of the history — which for a coding agent means
  it could say "no errors" when there were some. It surfaced as a CI flake first: one leg saw one of
  two events and blocked a release.

  The hub now sends `history-complete` once per connection, after the replay, and the MCP server waits
  for it before its first answer. The dashboard ignores it; a new consumer that answers questions
  right after connecting should wait for it too.

  Tests that assert on a frame sequence need to skip it — it is a boundary, not data.

## 0.4.0

### Minor Changes

- 9bd4782: Collapse consecutive duplicate console events into one with a `repeat` count.

  A broken webview emits the same error thousands of times per second, and that one line used
  to consume every buffer in the system. Measured before this change: after 3,000 identical
  messages, the hub's 2,000-event history held **one distinct message** and the error that
  started the cascade was gone — which makes the capture file, the primary path on a
  security-locked build, useless exactly when it matters.

  Coalescing happens in the agent's ring buffer (so exported captures stay useful) and in the
  live transport's pending queue (so the hub's history and any late-joining dashboard see it
  too, and the connection carries less). Only console and page errors coalesce — network and
  navigation events stay separate, because requesting the same URL twice is not the same fact
  as requesting it once. The first occurrence's timestamp is kept so timeline position doesn't
  drift, and the count is shown rather than hidden.

  `SessionEvent` gains an optional `repeat` field on `console` and `pageerror` (absent means 1),
  which is backward compatible — older dashboards ignore it, and the capture file version is
  unchanged.

- c42a14d: Record when a repeated error stopped, not just when it started.

  Coalescing consecutive duplicates keeps the first occurrence's timestamp so the timeline
  position stays put — but that alone loses something important. An error repeating every five
  seconds for ten minutes collapsed to a single line stamped `10:00:00 ×120`, which reads as
  "it happened a few times at the start and stopped". Whether it is _still_ happening is often
  the most useful fact in the log.

  `console` and `pageerror` events now carry an optional `repeatUntil` (the last occurrence), and
  the dashboard shows the span next to the count — `×120 10m` — so an ongoing failure can't be
  mistaken for a burst. Bursts shorter than a second show no span, since a duration adds nothing
  there.

## 0.3.0

### Minor Changes

- 348209f: Screen recording, as an opt-in plugin. `@crosspane/agent-replay` records the DOM with rrweb and rides the core agent's existing session timeline, so screen frames stay ordered alongside console and network events and land in `.crosspane.json` exports. The dashboard gains a **Screen** tab that plays them back, loading the player lazily so nobody pays for it unless a session actually has a recording.

  A prebuilt single-file bundle is included for environments without a bundler; it keeps `@crosspane/agent` external so the page reuses the agent instance it already loaded rather than starting a second session.

  It is a separate package because rrweb is tens of times larger than the core agent — the "no third-party dependencies, a few KB" promise of `@crosspane/agent` stays intact. The core gains one small extension point (`agent.emit`) and the protocol a generic `screen` event whose `format` field leaves room for non-rrweb capture methods later.

## 0.2.0

### Minor Changes

- 79ed26a: **crosspane is now a webview debugging toolkit.**

  The multi-engine preview (Playwright + iOS Simulator + Android emulator mirroring) is gone.
  It could never reach the environments this project actually cares about: production in-app
  webviews, in-app browsers, and security-hardened builds where remote inspectors are blocked
  outright. That version is preserved at the `crosspane@0.6.2` tag.

  What replaces it:

  - **`@crosspane/agent`** — a dependency-free SDK you embed in dev/QA builds. Hooks console,
    uncaught errors, unhandled rejections, fetch/XHR and navigations into a crash-resistant ring
    buffer. Stream live to the hub over your LAN, or export a `.crosspane.json` capture file when
    the network isn't an option (ISMS-P / MDM locked devices).
  - **`crosspane`** — the hub CLI is now a session relay: receives live agents on `/agent`, serves
    the dashboard, replays history to late-joining dashboards. No browser dependencies, so
    installs are megabytes instead of hundreds.
  - **Dashboard** — session list (multiple devices at once, live/ended, error badges), console and
    network panels, and drag-and-drop replay of capture files through the exact same UI.
  - **`@crosspane/protocol`** — shared wire types, published so integrations can build on them.

### Patch Changes

- 107330d: Package docs and metadata for npm: README, LICENSE, repository/homepage/bugs fields.
