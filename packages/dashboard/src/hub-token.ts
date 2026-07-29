/**
 * 허브 접속 토큰 — 대시보드가 자기 URL(`?t=…`)에서 받아 모든 허브 요청에 붙인다.
 *
 * 허브를 네트워크에 노출하면 토큰을 요구한다(없으면 같은 Wi-Fi의 누구나 세션 로그를
 * 읽는다). 사용자는 CLI가 출력한 토큰 포함 URL을 열고, 그 뒤로는 신경 쓰지 않아야 한다.
 *
 * URL에서 지운 뒤 메모리에 들고 있는다: 주소창·공유 링크·브라우저 히스토리에 토큰이
 * 남지 않게 하려는 것이다. 그래서 **새로고침만으로는 유지되지 않는다** —
 * sessionStorage에 함께 넣어 같은 탭의 새로고침은 통과시킨다.
 */
const STORAGE_KEY = 'crosspane.hubToken';

let token: string | null = null;

function readToken(): string | null {
  if (token !== null) return token;
  const fromUrl = new URLSearchParams(location.search).get('t');
  if (fromUrl) {
    token = fromUrl;
    try {
      sessionStorage.setItem(STORAGE_KEY, fromUrl);
      // 주소창에서 지운다 — 링크를 공유하거나 히스토리에 남는 사고를 줄인다
      history.replaceState(null, '', location.pathname);
    } catch {
      // 프라이빗 모드 등에서 sessionStorage가 막힐 수 있다 — 메모리 값으로 계속 동작
    }
    return token;
  }
  try {
    token = sessionStorage.getItem(STORAGE_KEY);
  } catch {
    token = null;
  }
  return token;
}

/** 허브 경로에 토큰 쿼리를 붙인다 (토큰이 없으면 경로 그대로) */
export function withHubToken(path: string): string {
  const value = readToken();
  if (!value) return path;
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}t=${encodeURIComponent(value)}`;
}
