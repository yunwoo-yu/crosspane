/**
 * 화면(rrweb) 이벤트 버퍼 관리 — 순수 함수.
 *
 * rrweb은 DOM 변경마다 이벤트를 뱉으므로 초당 수십~수백 건이 될 수 있다.
 * 로그·네트워크와 같은 이유로 배칭 대상이고, 여기에 상한이 하나 더 필요하다.
 */

/** rrweb EventType — 재생 시작점 판정에만 쓰므로 필요한 값만 둔다 */
const RRWEB_FULL_SNAPSHOT = 2;
const RRWEB_META = 4;

function eventType(event: unknown): number | undefined {
  return typeof event === 'object' && event !== null && 'type' in event
    ? (event as { type?: number }).type
    : undefined;
}

/**
 * 상한을 넘으면 앞에서 버리되, **재생 가능한 체크포인트에서만 자른다.**
 *
 * rrweb 스트림은 [Meta, FullSnapshot, 증분…] 구조다. 아무 데서나 자르면
 * 전체 스냅샷이 사라져 재생 자체가 불가능해진다 — 메모리를 아끼려다 기록을
 * 무용지물로 만드는 셈. 잘라낼 체크포인트가 없으면 상한을 넘겨서라도 유지한다
 * (기록 플러그인의 checkoutEveryNms가 주기적으로 체크포인트를 만들어 준다).
 */
export function trimScreenEvents(events: unknown[], max: number): unknown[] {
  if (events.length <= max) return events;

  // 뒤에서부터 훑어 상한 안에 들어오는 가장 이른 FullSnapshot을 찾는다
  for (let i = events.length - max; i < events.length; i++) {
    if (eventType(events[i]) !== RRWEB_FULL_SNAPSHOT) continue;
    // 바로 앞 Meta까지 포함해야 재생기가 뷰포트 크기를 안다
    const start = i > 0 && eventType(events[i - 1]) === RRWEB_META ? i - 1 : i;
    return events.slice(start);
  }
  return events; // 체크포인트 없음 — 자르면 재생 불가라 그대로 둔다
}

/** 세션별 버퍼에 새 이벤트들을 합치고 상한을 적용한다 */
export function mergeScreenEvents(
  current: Record<string, unknown[]>,
  incoming: Record<string, unknown[]>,
  max: number,
): Record<string, unknown[]> {
  const next = { ...current };
  for (const [sessionId, events] of Object.entries(incoming)) {
    if (events.length === 0) continue;
    next[sessionId] = trimScreenEvents([...(next[sessionId] ?? []), ...events], max);
  }
  return next;
}
