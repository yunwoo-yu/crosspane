/**
 * 캡처 텍스트를 클립보드로 내보낸다 — 다운로드가 막힌 환경의 탈출구.
 *
 * 왜 필요한가: 오프라인 캡처는 보안 잠금 빌드의 **주력 경로**인데, 유일한 출구였던
 * blob 다운로드(`a[download].click()`)는 앱이 다운로드를 구현하지 않은 웹뷰에서
 * 조용히 아무 일도 하지 않는다 (Android는 `setDownloadListener`, iOS는
 * `WKDownloadDelegate`가 필요하고, 인앱브라우저는 대개 막아 둔다).
 *
 * 왜 execCommand가 폴백이 아니라 주 경로인가 (실측): QA 기기가 사내 빌드를 여는
 * `http://<사내 IP>`는 보안 컨텍스트가 아니다 → `navigator.clipboard`와
 * `navigator.share`가 **정의조차 되지 않는다**. 최신 API만 쓰면 정작 타깃 환경에서
 * 전부 실패한다. deprecated 경고를 이유로 지우지 말 것.
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 권한 거부 또는 사용자 제스처 없음 — 아래로 내려간다
    }
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  if (typeof document.execCommand !== 'function') return false;

  const previouslyFocused = document.activeElement;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('aria-hidden', 'true');
  area.setAttribute('tabindex', '-1');
  // 레이아웃을 밀지도, 스크롤을 움직이지도 않게 — 페이지에 영향을 주면 안 된다
  area.style.cssText =
    'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;pointer-events:none;';
  document.body.appendChild(area);
  try {
    area.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
    // 입력 중이던 사용자를 방해하지 않도록 포커스를 돌려준다
    if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
  }
}
