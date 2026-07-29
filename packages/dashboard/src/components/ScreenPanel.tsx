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

  useEffect(() => {
    const container = containerRef.current;
    // rrweb 플레이어는 최초 전체 스냅샷 + 이후 diff 구조라 최소 2개가 필요하다
    if (!container || events.length < 2) return;

    // rrweb-player의 컴포넌트 타입은 destroy를 노출하지 않는다 — 해제 시 좁힌다
    let player: unknown = null;
    let cancelled = false;

    void (async () => {
      try {
        const { default: Player } = await import('rrweb-player');
        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = '';
        player = new Player({
          target: containerRef.current,
          props: {
            events: events as never,
            autoPlay: false,
            width: containerRef.current.clientWidth || 360,
            height: Math.round((containerRef.current.clientWidth || 360) * 1.6),
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
  }, [events]);

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
