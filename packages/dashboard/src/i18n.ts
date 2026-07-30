/**
 * 대시보드 문구의 한국어·영어 단일 소스.
 *
 * 라이브러리를 쓰지 않는 이유: 문구가 수십 개이고 복수형·날짜 포맷 같은 요구가 없다.
 * i18n 라이브러리를 넣으면 대시보드 번들이 커지고, 이 프로젝트에서 번들 크기는
 * 에이전트만의 문제가 아니다 — 대시보드는 허브가 서빙하므로 `npx crosspane` 첫 실행의
 * 체감 속도가 된다.
 *
 * **`Messages`가 키의 단일 정의다.** 한 언어에 키를 추가하면 다른 언어에서 빠졌을 때
 * 타입 에러가 난다 — 번역 누락이 조용히 영어로 새는 것을 컴파일 단계에서 막는다.
 */

export type Locale = 'ko' | 'en';

/**
 * `as const`를 쓰지 않는 이유: 값까지 리터럴로 굳으면 `hub connected`가 타입이 되어
 * 한국어 값이 대입되지 않는다. 우리가 원하는 계약은 **키 집합과 함수 시그니처**이지
 * 값 자체가 아니다.
 */
const en = {
  appTitle: 'crosspane',
  hubConnected: 'hub connected',
  connecting: 'connecting…',
  replay: 'replay',
  backToLive: 'Back to live',
  openCapture: 'Open capture…',
  /** 좁은 화면용 축약 — 긴 라벨은 390px에서 헤더를 넘치게 해 "Clear"가 잘렸다(실측) */
  openCaptureShort: 'Open',
  saveSessionShort: 'Save',
  openCaptureLabel: 'open capture file',
  clear: 'Clear',
  noSessions: 'No sessions yet',
  allSessions: 'All sessions',
  live: 'live',
  ended: 'ended',
  tabConsole: 'Console',
  tabNetwork: 'Network',
  tabScreen: 'Screen',
  filterLogs: 'Filter logs',
  searchLogs: 'search logs',
  filterUrls: 'Filter URLs',
  searchRequests: 'search requests',
  resumeFollowing: 'Resume following new logs',
  noRequests: 'No requests yet — interact with the page',
  xhrFetchOnly: 'XHR/fetch',
  hideStaticAssets: 'Hide static assets — show XHR/fetch only',
  onlyFailed: 'Only failed requests (network error, 4xx, 5xx)',
  noScreenRecording: 'No screen recording in this session',
  waitingSnapshot: 'Waiting for the first full snapshot…',
  playerLoadFailed: 'Could not load the player',
  fileReadFailed: 'Could not read that file',
  pointAppHere: 'Point your app at this hub',
  localOnlyRestart: 'Local only — restart with',
  copy: 'copy',
  copied: 'copied',
  levelAll: 'all',
  levelLog: 'log',
  levelWarning: 'warning',
  levelError: 'error',
  warningAndAbove: 'warning and above',
  language: 'Language',
  saveSession: 'Save session',
  emptyStateHint:
    'Add @crosspane/agent to your app and point it at this hub, or drop a .crosspane.json capture file here to replay it.',
  droppedTitle:
    'The buffer dropped these before the file was written — the session started earlier than the first entry shown',
  screenHint:
    'Add @crosspane/agent-replay and call startScreenRecording(agent) to capture what the screen looked like.',
  /** 화면 상한을 밝히는 문구 — 상한은 반드시 보여야 한다 (ARCHITECTURE.md) */
  olderHidden: (count: string) => `${count} older entries hidden — filter or search to reach them`,
  jumpToLatest: '↓ Latest',
  kindNavigate: 'navigate',
  errorsOnly: 'errors',
  repeatTitle: (repeat: number, span: string | null) =>
    span === null
      ? `${repeat} consecutive occurrences`
      : `${repeat} consecutive occurrences over ${span} — still recurring, not a one-off burst`,
  requestCount: (shown: number, total: string | null) =>
    total === null ? `${shown} requests` : `${shown} of ${total} requests (filter to narrow)`,
  repeatedTimes: (count: number) => `×${count}`,
  replayingToast: (label: string, logs: number) => `Replaying ${label} (${logs} logs)`,
  earlierDropped: (count: string) => `${count} earlier events dropped`,
};

/** 영어 정의를 키의 계약으로 삼는다 — 빠진 번역은 타입 에러가 된다 */
export type Messages = typeof en;

const ko: Messages = {
  appTitle: 'crosspane',
  hubConnected: '허브 연결됨',
  connecting: '연결 중…',
  replay: '리플레이',
  backToLive: '라이브로 돌아가기',
  openCapture: '캡처 파일 열기…',
  openCaptureShort: '열기',
  saveSessionShort: '저장',
  openCaptureLabel: '캡처 파일 열기',
  clear: '지우기',
  noSessions: '아직 세션이 없습니다',
  allSessions: '전체 세션',
  live: '라이브',
  ended: '종료됨',
  tabConsole: '콘솔',
  tabNetwork: '네트워크',
  tabScreen: '화면',
  filterLogs: '로그 검색',
  searchLogs: '로그 검색',
  filterUrls: 'URL 검색',
  searchRequests: '요청 검색',
  resumeFollowing: '새 로그 따라가기 재개',
  noRequests: '아직 요청이 없습니다 — 페이지를 조작해 보세요',
  xhrFetchOnly: 'XHR/fetch',
  hideStaticAssets: '정적 리소스 숨기기 — XHR/fetch만 보기',
  onlyFailed: '실패한 요청만 (네트워크 오류, 4xx, 5xx)',
  noScreenRecording: '이 세션에는 화면 기록이 없습니다',
  waitingSnapshot: '첫 전체 스냅샷을 기다리는 중…',
  playerLoadFailed: '플레이어를 불러오지 못했습니다',
  fileReadFailed: '파일을 읽지 못했습니다',
  pointAppHere: '앱을 이 허브로 연결하세요',
  localOnlyRestart: '로컬 전용 — 다시 실행하세요',
  copy: '복사',
  copied: '복사됨',
  levelAll: '전체',
  levelLog: '로그',
  levelWarning: '경고',
  levelError: '에러',
  warningAndAbove: '경고 이상',
  language: '언어',
  saveSession: '세션 저장',
  emptyStateHint:
    '앱에 @crosspane/agent를 넣고 이 허브를 가리키게 하거나, .crosspane.json 캡처 파일을 여기에 끌어다 놓으면 재생됩니다.',
  droppedTitle:
    '파일이 쓰이기 전에 버퍼가 버린 이벤트입니다 — 세션은 첫 항목보다 먼저 시작됐습니다',
  screenHint:
    '@crosspane/agent-replay를 추가하고 startScreenRecording(agent)를 호출하면 화면이 어땠는지 기록됩니다.',
  olderHidden: (count) => `이전 ${count}건 숨김 — 필터나 검색으로 찾을 수 있습니다`,
  jumpToLatest: '↓ 최신',
  kindNavigate: '페이지 이동',
  errorsOnly: '에러만',
  repeatTitle: (repeat, span) =>
    span === null
      ? `연속 ${repeat}회 발생`
      : `${span} 동안 연속 ${repeat}회 — 초반에 몰린 게 아니라 계속 발생 중입니다`,
  requestCount: (shown, total) =>
    total === null ? `요청 ${shown}건` : `${total}건 중 ${shown}건 표시 (필터로 좁히세요)`,
  repeatedTimes: (count) => `×${count}`,
  replayingToast: (label, logs) => `${label} 재생 중 (로그 ${logs}건)`,
  earlierDropped: (count) => `이전 이벤트 ${count}건 버려짐`,
};

const MESSAGES: Record<Locale, Messages> = { en, ko };
const STORAGE_KEY = 'crosspane:locale';

/**
 * 처음 열었을 때의 언어. 저장된 선택 > 브라우저 설정 > 영어.
 *
 * 브라우저 설정을 보는 이유: 이 툴의 사용자층은 한국어 개발자가 많은데, 매번 언어를
 * 고르게 만들 이유가 없다. 저장된 선택이 항상 이긴다 — 한 번 바꾼 것을 되돌리지 않는다.
 */
export function initialLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'ko' || stored === 'en') return stored;
  } catch {
    // 저장소가 막힌 환경 — 브라우저 설정으로 넘어간다
  }
  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('ko')
    ? 'ko'
    : 'en';
}

export function storeLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // 저장 못 해도 이번 세션에는 반영된다
  }
}

export function messagesFor(locale: Locale): Messages {
  return MESSAGES[locale];
}
