// --verbose 진단 로거 — 평소에 조용히 삼키는 폴백/복구 경로의 원인을 노출한다.
// 버그 리포트에 붙일 수 있는 로그를 만드는 것이 목적이므로 스택을 자르지 않는다.
let verboseEnabled = false;

export function setVerbose(enabled: boolean): void {
  verboseEnabled = enabled;
}

export function isVerbose(): boolean {
  return verboseEnabled;
}

/** verbose 모드에서만 출력. Error는 전체 스택을 보존한다 */
export function debugLog(scope: string, message: unknown): void {
  if (!verboseEnabled) return;
  const text = message instanceof Error ? (message.stack ?? message.message) : String(message);
  console.error(`  [debug:${scope}] ${text}`);
}
