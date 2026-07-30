---
'crosspane': patch
---

문서를 실제 동작에 맞추고 한국어 README를 추가했다.

- **한국어 README** (`README.ko.md`) — 이 툴의 사용자층에 한국어 개발자가 많고,
  대시보드에 ko를 넣은 것과 같은 이유다. 두 문서가 어긋나면 영어판이 기준임을 명시했다.
- **CLI 문서가 낙후돼 있었다** — `--lan-tls` / `--tunnel` / `--hostname` / `--ingest-key`가
  README의 CLI 목록에 통째로 빠져 있었다. `crosspane --help`와 맞췄다.
- **`--lan-tls`가 접힌 섹션에 묻혀 있었다.** 배포된 페이지를 폰에서 보는 가장 쉬운 길인데
  (설치 0·계정 0, 실기기 확인) 터널 뒤에 있었다. 이제 배포 페이지의 첫 답으로 올렸고,
  터널은 "Wi-Fi 밖에서 닿아야 할 때"로 위치를 바꿨다.
- `crosspane --host 0.0.0.0 --lan-tls` → `crosspane --lan-tls` (단독으로 선다)
- 터미널의 세션 알림과 대시보드 ko/en을 문서에 반영했다.
