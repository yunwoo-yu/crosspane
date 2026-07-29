import { useEffect, useRef, useState } from 'react';

interface ScreenPanelProps {
  /** 이 세션의 rrweb 이벤트 (프로토콜의 screen.data 원본) */
  events: unknown[];
}

/**
 * 화면 재생 — rrweb-player를 **동적 import**한다.
 * 정적으로 넣으면 화면 기록을 안 쓰는 사용자도 수백 KB를 받게 되고,
 * 대시보드 첫 페인트가 그만큼 늦어진다.
 */
export function ScreenPanel({ events }: ScreenPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 컨테이너 실측 너비 — 플레이어는 생성 시점 크기로 스케일을 고정하므로
  // 0이나 잘못된 값을 주면 재생 화면이 패널 밖으로 잘린다 (실측 버그)
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      // 소수점 변동으로 플레이어를 재생성하지 않도록 정수로 스냅
      setWidth(Math.floor(entry.contentRect.width));
    });
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
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the player');
      }
    })();

    return () => {
      cancelled = true;
      // 버전에 따라 해제 메서드 이름이 다르다 (svelte 3의 $destroy / 4의 destroy)
      const instance = player as { destroy?: () => void; $destroy?: () => void } | null;
      (instance?.destroy ?? instance?.$destroy)?.call(instance);
    };
  }, [events, width]);

  if (events.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 p-6 text-fg-muted">
        <span className="text-sm">No screen recording in this session</span>
        <span className="max-w-md text-center text-xs">
          Add <code className="text-fg">@crosspane/agent-replay</code> and call{' '}
          <code className="text-fg">startScreenRecording(agent)</code> to capture what the screen
          looked like.
        </span>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto p-3">
      {error && <div className="mb-2 text-danger text-xs">{error}</div>}
      {events.length < 2 && (
        <div className="mb-2 text-fg-muted text-xs">Waiting for the first full snapshot…</div>
      )}
      <div ref={containerRef} className="crosspane-player" />
    </div>
  );
}
