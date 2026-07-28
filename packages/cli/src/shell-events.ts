/**
 * 셸앱(iOS/Android)이 POST하는 이벤트 페이로드의 단일 파서.
 * 어댑터별로 복제돼 있던 매핑이 드리프트했던 지점(레벨 정규화, 형태 검증)을 통일한다.
 */
export type ShellEvent =
  | { kind: 'console'; level: string; text: string }
  | { kind: 'pageerror'; text: string }
  | { kind: 'navigation'; url: string };

/** 잘못된/모르는 페이로드는 null — 셸 버전 차이로 온 이벤트가 크래시가 되면 안 된다 */
export function parseShellEvent(payload: unknown): ShellEvent | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const event = payload as { kind?: string; level?: string; text?: string; url?: string };
  switch (event.kind) {
    case 'console':
      return {
        kind: 'console',
        // 셸(WebKit/WebView)은 'warn'으로 보내지만 프로토콜 LogLevel은 'warning'이다
        level: event.level === 'warn' ? 'warning' : (event.level ?? 'log'),
        text: event.text ?? '',
      };
    case 'pageerror':
      return { kind: 'pageerror', text: event.text ?? 'unknown error' };
    case 'navigation':
      return event.url ? { kind: 'navigation', url: event.url } : null;
    default:
      return null;
  }
}
