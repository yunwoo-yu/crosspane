---
'crosspane': minor
---

한글 IME 입력 + 픽셀 diff + 버그 리포트 + iOS pane 인터랙티브 수정

- **한글 IME 입력 지원**: pane 키 입력을 숨김 input 경유로 바꿔 조합형 입력(한글 등)이
  브라우저 엔진과 iOS WKWebView 셸에서 동작. Android 에뮬레이터는 adb 한계로 비ASCII
  입력 시 콘솔에 안내
- **Diff 탭**: 두 엔진의 현재 프레임을 픽셀 비교해 다른 영역을 하이라이트 + 차이 비율 표시
- **⤓ report 버튼**: 엔진별 스크린샷·콘솔·네트워크(에러/4xx 상단 분리)를 단일
  자급자족 HTML로 다운로드 — 이슈에 파일 하나로 첨부
- **iOS pane view-only 버그 수정**: navigation 이벤트가 engine 상태의 viewOnly/detail을
  덮어써 셸 모드에서도 view-only로 보이던 문제 수정 — WKWebView 셸에서 클릭/타이핑/
  한글 입력이 실제로 동작
- iOS 셸 keypress 확장: Enter(폼 제출 포함)·화살표 등 특수키 전달
- WKWebView 셸 실패 시 폴백 이유를 콘솔에 표시 (조용한 view-only 강등 제거)
