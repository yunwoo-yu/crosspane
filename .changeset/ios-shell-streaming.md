---
'crosspane': minor
---

iOS pane 셸 자체 스트리밍 — simctl 폴링 탈피 (전부 공개 API)

- 셸앱이 `takeSnapshot`으로 자체 캡처해 호스트로 push — 입력→화면 반영이
  simctl 폴링(왕복 수백 ms) 대비 대폭 단축, 변화 없으면 idle로 CPU 절약
- 스크롤이 JS `scrollBy`가 아니라 **UIScrollView 네이티브 경로** (드래그는 감속
  스텝 애니메이션) — iOS pane 스크롤이 실기기 감각
- 프레임에 contentOffset 동봉 → iOS pane에도 스크롤 로컬 에코 적용
- 서버 셸 브릿지에 프레임 push 라우트(`/shell/:engine/frame`) 추가,
  셸 스트림이 흐르면 simctl 폴링 자동 중단
- 알려진 한계 문서화: 유효 fps ~5는 WebKit 스냅샷 케이던스 한계 (30fps는 idb 로드맵)
