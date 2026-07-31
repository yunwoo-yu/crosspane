import type { LogEntry, NetworkEntry } from './types';

/**
 * 통합 타임라인 — 로그·요청·상호작용·성능 지표를 **한 줄기**로 합친다.
 *
 * 왜 별도 화면이 필요한가: 개발자도구의 가장 큰 불편은 탭이 갈라져 있다는 것이다.
 * 콘솔 탭에서 에러를 보고, 네트워크 탭으로 옮겨 그 시각 근처의 요청을 눈으로 찾고,
 * 무엇을 눌러서 그렇게 됐는지는 어디에도 없다. 디버깅은 대개 **인과**를 찾는 일인데
 * 인과는 시간축에 있고, 시간축이 네 개로 쪼개져 있으면 사람이 머릿속에서 합쳐야 한다.
 *
 * 여기서는 하나로 합치고 종류로 걸러 낸다. 깊이 파는 일(본문 미리보기, 헤더)은
 * 기존 콘솔·네트워크 탭이 계속 맡는다 — 이 화면은 "무슨 일이 있었나"를 위한 곳이다.
 */

export type TimelineKind = 'console' | 'error' | 'network' | 'interaction' | 'vital' | 'navigation';

export interface TimelineItem {
  /** 원본 종류가 무엇이든 화면에서는 이 값 하나로 필터·색을 정한다 */
  kind: TimelineKind;
  key: string;
  sessionId: string;
  ts: number;
  /** 왼쪽 라벨 — 종류를 한눈에 (`click` `GET` `LCP`) */
  label: string;
  text: string;
  detail?: string;
  /** 실패·에러·나쁜 지표 — 눈에 띄어야 하는 줄 */
  bad?: boolean;
  /** 반복 합쳐진 로그의 횟수 */
  repeat?: number;
}

const LOG_KIND: Record<string, TimelineKind> = {
  console: 'console',
  pageerror: 'error',
  navigation: 'navigation',
  interaction: 'interaction',
  vital: 'vital',
};

/**
 * 화면에서 쓸 종류. **`console`이면서 레벨이 error인 것은 error로 친다** —
 * 사용자가 "에러만" 필터로 찾는 것은 레벨이지 이벤트가 어디서 왔는지가 아니다.
 * 필터와 건수 표시가 같은 함수를 써야 "3건이라며 왜 안 보이지"가 생기지 않는다.
 */
function kindOf(entry: LogEntry): TimelineKind {
  const kind = LOG_KIND[entry.kind] ?? 'console';
  return kind === 'console' && entry.level === 'error' ? 'error' : kind;
}

function fromLog(entry: LogEntry): TimelineItem {
  const kind = kindOf(entry);
  return {
    kind,
    key: `l${entry.id}`,
    sessionId: entry.sessionId,
    ts: entry.ts,
    // 상호작용·성능은 텍스트 앞머리가 이미 종류를 말한다 (`click  button#pay`)
    label: kind === 'interaction' || kind === 'vital' ? '' : entry.level,
    text: entry.text,
    detail: entry.detail,
    bad: entry.level === 'error' || entry.level === 'warning',
    repeat: entry.repeat,
  };
}

function fromNetwork(entry: NetworkEntry): TimelineItem {
  // 상태를 모르는 것(리소스 타이밍 관측)은 실패가 아니다 — 빨갛게 칠하면 오도한다
  const failed = entry.status !== undefined && (entry.status === 0 || entry.status >= 400);
  const status = entry.status === undefined ? '—' : entry.status === 0 ? 'ERR' : entry.status;
  return {
    kind: 'network',
    key: `n${entry.id}`,
    sessionId: entry.sessionId,
    ts: entry.ts,
    label: entry.method,
    text: `${status}  ${entry.url}`,
    detail: entry.error,
    bad: failed,
  };
}

/**
 * 합쳐서 시간순(오래된 것 → 최신)으로.
 *
 * 콘솔과 같은 방향인 이유: 두 화면을 오가며 읽는 사람이 방향까지 바꿔 생각하게
 * 만들면 안 된다. 네트워크 탭만 최신이 위인데, 그쪽은 "지금 뭐가 실패했나"를 보는
 * 화면이라 다른 것이 맞다.
 */
export function buildTimeline(
  logs: LogEntry[],
  network: NetworkEntry[],
  kinds: Set<TimelineKind>,
): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const entry of logs) {
    const item = fromLog(entry);
    if (kinds.has(item.kind)) items.push(item);
  }
  if (kinds.has('network')) {
    for (const entry of network) {
      if (isMeaningfulRequest(entry)) items.push(fromNetwork(entry));
    }
  }
  return items.sort((a, b) => a.ts - b.ts);
}

/**
 * 이 화면에 실을 만한 요청인가 — **앱이 부른 것만.**
 *
 * 실측(Vite dev 서버에 붙였을 때): 첫 화면 21줄 중 대부분이 `/@vite/client`,
 * `/node_modules/.vite/deps/…`, `/@react-refresh` 같은 개발 서버 내부 요청이었다.
 * 정작 봐야 할 클릭 한 줄이 그 사이에 묻혔다. 인과를 읽는 화면에서 이건 노이즈다.
 *
 * 정적 리소스를 시간순으로 훑는 일은 드물고, 그건 네트워크 탭이 맡는다 —
 * 거기서는 필터를 끄면 전부 볼 수 있고 가려진 건수도 표시된다.
 */
function isMeaningfulRequest(entry: NetworkEntry): boolean {
  // 실패는 무엇이든 보여준다 — 깨진 이미지 하나가 원인인 경우가 실제로 있다
  if (entry.status !== undefined && (entry.status === 0 || entry.status >= 400)) return true;
  return entry.initiator === undefined || entry.initiator === 'fetch' || entry.initiator === 'xhr';
}

/** 검색어 적용 — 라벨과 본문 둘 다 본다 (`GET`으로도, URL로도 찾을 수 있게) */
export function searchTimeline(items: TimelineItem[], search: string): TimelineItem[] {
  const query = search.trim().toLowerCase();
  if (!query) return items;
  return items.filter(
    (item) => item.text.toLowerCase().includes(query) || item.label.toLowerCase().includes(query),
  );
}

/** 종류별 건수 — 필터 칩에 숫자를 달아 "여기 뭐가 있는지"를 열기 전에 알린다 */
export function countByKind(
  logs: LogEntry[],
  network: NetworkEntry[],
): Record<TimelineKind, number> {
  const counts: Record<TimelineKind, number> = {
    console: 0,
    error: 0,
    // 칩의 숫자는 **실제로 보이는 수**여야 한다 — 21이라고 해 놓고 3줄만 나오면
    // 사용자는 나머지를 어디서 찾아야 할지 모른다
    network: network.filter(isMeaningfulRequest).length,
    interaction: 0,
    vital: 0,
    navigation: 0,
  };
  for (const entry of logs) counts[kindOf(entry)] += 1;
  return counts;
}
