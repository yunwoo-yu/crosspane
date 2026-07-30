import { useEffect, useRef, useState } from 'react';
import { useLocale } from '../hooks/useLocale';

interface ScreenPanelProps {
  /** 이 세션의 rrweb 이벤트 (프로토콜의 screen.data 원본) */
  events: unknown[];
}

/**
 * 화면 재생 — rrweb-player를 **동적 import**한다.
 * 정적으로 넣으면 화면 기록을 안 쓰는 사용자도 수백 KB를 받게 되고,
 * 대시보드 첫 페인트가 그만큼 늦어진다.
 */
/**
 * "플레이어를 못 불러왔다"를 문구 대신 이 값으로 저장한다 — 저장 시점에 번역하면
 * effect가 언어에 의존하게 되고(플레이어 재생성) 이미 뜬 문구도 언어를 못 따라간다.
 */
const PLAYER_LOAD_FAILED = 'crosspane:player-load-failed';

export function ScreenPanel({ events }: ScreenPanelProps) {
  const { t } = useLocale();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 컨테이너 실측 너비 — 플레이어는 생성 시점 크기로 스케일을 고정하므로
  // 0이나 잘못된 값을 주면 재생 화면이 패널 밖으로 잘린다 (실측 버그)
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // 소수점 변동으로 플레이어를 재생성하지 않도록 정수로 스냅
    const measure = (value: number) => setWidth(Math.floor(value));
    measure(container.getBoundingClientRect().width);

    // ResizeObserver가 없는 환경(구형 브라우저·jsdom)에서도 패널이 죽지 않아야 한다
    // — 그 경우 최초 측정값으로 재생하고 리사이즈 추적만 포기한다
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => measure(entry.contentRect.width));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    // rrweb 플레이어는 최초 전체 스냅샷 + 이후 diff 구조라 최소 2개가 필요하다
    if (!container || events.length < 2 || width === 0) return;

    // rrweb-player의 컴포넌트 타입은 destroy를 노출하지 않는다 — 해제 시 좁힌다
    let player: unknown = null;
    let cancelled = false;

    void (async () => {
      try {
        // 플레이어 CSS도 함께 동적 로드 — 없으면 컨트롤이 스타일 없이 쌓이고
        // 재생 영역 크기가 잡히지 않는다 (실측)
        const [{ default: Player }] = await Promise.all([
          import('rrweb-player'),
          import('rrweb-player/dist/style.css'),
        ]);
        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = '';
        // 컨트롤 바(약 80px)를 뺀 높이를 주고, 세로 화면 비율을 넘지 않게 제한한다
        const height = Math.min(Math.round(width * 1.6), container.clientHeight - 80 || 480);
        player = new Player({
          target: containerRef.current,
          props: {
            events: events as never,
            autoPlay: false,
            width,
            height: Math.max(height, 240),
          },
        });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : PLAYER_LOAD_FAILED);
      }
    })();

    return () => {
      cancelled = true;
      // 버전에 따라 해제 메서드 이름이 다르다 (svelte 3의 $destroy / 4의 destroy)
      const instance = player as { destroy?: () => void; $destroy?: () => void } | null;
      (instance?.destroy ?? instance?.$destroy)?.call(instance);
    };
    // t를 의존성에 넣지 않는다: 언어를 바꿀 때마다 플레이어가 재생성되며 재생 위치가
    // 날아간다. 대신 센티널만 저장하고 문구는 렌더에서 고른다 — 이미 뜬 에러도 언어를
    // 따라간다(예전에는 처음 뜬 언어 그대로 굳었다)
  }, [events, width]);

  if (events.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 p-6 text-fg-muted">
        <span className="text-sm">{t.noScreenRecording}</span>
        <span className="max-w-md text-center text-xs">{t.screenHint}</span>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto p-3">
      {error && (
        <div className="mb-2 text-danger text-xs">
          {error === PLAYER_LOAD_FAILED ? t.playerLoadFailed : error}
        </div>
      )}
      {events.length < 2 && <div className="mb-2 text-fg-muted text-xs">{t.waitingSnapshot}</div>}
      <div ref={containerRef} className="crosspane-player" />
    </div>
  );
}
