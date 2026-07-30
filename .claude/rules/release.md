---
paths:
  - ".github/workflows/*.yml"
  - ".changeset/**"
  - "scripts/ci-publish.mjs"
  - "scripts/check-publishable.mjs"
---

# 릴리스 절차의 함정 (실측)

배포는 changeset → "chore: version packages" PR 머지로 자동. 그런데 그 PR을 머지하는
길에 두 개의 덫이 있다.

## 1. 릴리스 PR의 CI는 자동으로 돌지 않는다

changesets 액션이 `GITHUB_TOKEN`으로 PR을 만들기 때문에 GitHub이 **재귀 방지**로
후속 워크플로를 트리거하지 않는다. PR의 CI가 `completed action_required`로 남고,
그 상태의 실행은 승인 API로도 되살릴 수 없다.

→ `gh run rerun <id>`로 재실행하면 정상 실행된다(실측). 근본 해결은 changesets 액션에
PAT를 주는 것이며, 그건 저장소 시크릿이 필요하다.

## 2. 필수 체크 이름은 매트릭스를 바꾸면 깨진다

브랜치 보호의 required contexts는 **잡 이름 문자열**이다. CI 매트릭스에 Node 버전을
추가하자 잡 이름이 `ci (ubuntu-latest)` → `ci (ubuntu-latest, 22)`로 바뀌었고,
보호 설정은 옛 이름을 요구한 채 남아 **3개가 영원히 충족 불가**가 됐다. 실제로
강제되던 것은 `smoke` 하나뿐이었고 `enforce_admins: false`라 소유자 우회로 릴리스가
나가고 있었다(2026-07-30 발견, 그때 교정).

→ **CI 매트릭스를 건드리면 브랜치 보호의 required contexts를 함께 갱신할 것.**
현재 요구값: `smoke`, `ci (ubuntu-latest, 20)`, `ci (ubuntu-latest, 22)`,
`ci (macos-latest, 22)`, `ci (windows-latest, 22)`

## 3. 배포 후에는 실제로 설치해서 확인한다

`check:publishable`은 런타임 의존성의 `workspace:`만 본다(devDependencies는 설치되지
않으므로 의도적 제외 — 스크립트 주석 참조). 그래도 릴리스 후 빈 디렉터리에서
`npm i crosspane@<버전>` → 기동 → 주요 경로를 눌러 보는 것이 마지막 관문이다.
0.7.0이 설치 불가 상태로 배포된 이력이 있다.

## 대시보드를 changeset에 넣지 말 것

`packages/dashboard`는 **private**(`crosspane-dashboard`)이고 `crosspane`의 `dist/public`에
번들돼 나간다. 배포되는 것은 `crosspane` 하나다.

changeset에 넣으면 Release가 두 가지 방식으로 실패한다 — 둘 다 실측:
- 이름을 `@crosspane/dashboard`로 쓰면 `Found changeset ... which is not in the workspace`
  (워크스페이스 이름은 `crosspane-dashboard`다)
- 올바른 이름을 써도 `Mixed changesets that contain both ignored and not ignored packages
  are not allowed` — private 패키지는 `ignore` 취급이라 `crosspane`과 같은 changeset에 못 들어간다

**대시보드만 바뀐 변경도 changeset에는 `crosspane`만 적는다.** 사용자는 그것을 설치하고,
대시보드는 그 안에 들어 있다.

이 실패는 머지 **후에** 드러난다(Release는 main push에서 돈다). CI가 초록이어도
릴리스가 못 나갈 수 있으니, changeset을 쓸 때 패키지 이름을 확인할 것:
`node -e "console.log(require('./packages/<p>/package.json').name)"`
