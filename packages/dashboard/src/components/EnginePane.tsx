import { useEffect, useRef, useState } from 'react';
import { ENGINE_LABEL, WHEEL_COALESCE_MS } from '../constants';
import type { ClientCommand, EngineName, EngineState, FrameListener } from '../types';

interface EnginePaneProps {
  engine: EngineName;
  state: EngineState | undefined;
  errorCount: number;
  onSendCommand: (command: ClientCommand) => void;
  subscribeToFrames: (engine: EngineName, listener: FrameListener) => () => void;
}

export function EnginePane({
  engine,
  state,
  errorCount,
  onSendCommand,
  subscribeToFrames,
}: EnginePaneProps) {
  const screenRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onSendCommandRef = useRef(onSendCommand);
  onSendCommandRef.current = onSendCommand;
  const [hasFrame, setHasFrame] = useState(false);

  // 프레임은 React 상태를 거치지 않고 canvas에 직접 그린다 — 리렌더 비용 0
  useEffect(
    () =>
      subscribeToFrames(engine, (frame) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        if (canvas.width !== frame.width || canvas.height !== frame.height) {
          canvas.width = frame.width;
          canvas.height = frame.height;
        }
        canvas.getContext('2d')?.drawImage(frame, 0, 0);
        setHasFrame(true); // 같은 값이면 React가 리렌더를 생략하므로 매 프레임 호출해도 무해
      }),
    [engine, subscribeToFrames],
  );

  // React의 onWheel은 passive라 preventDefault가 불가능하다.
  // 네이티브 non-passive 리스너로 대시보드 자체 스크롤을 막고(미러링 전용),
  // 델타를 WHEEL_COALESCE_MS 동안 모아 하나의 커맨드로 보낸다.
  useEffect(() => {
    const screen = screenRef.current;
    if (!screen) return;
    let accumulatedDeltaY = 0;
    let flushTimer: number | null = null;

    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault();
      accumulatedDeltaY += event.deltaY;
      if (flushTimer === null) {
        flushTimer = window.setTimeout(() => {
          const deltaY = Math.round(accumulatedDeltaY);
          accumulatedDeltaY = 0;
          flushTimer = null;
          if (deltaY !== 0) onSendCommandRef.current({ type: 'scroll', deltaY });
        }, WHEEL_COALESCE_MS);
      }
    };

    screen.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      screen.removeEventListener('wheel', handleWheel);
      if (flushTimer !== null) window.clearTimeout(flushTimer);
    };
  }, []);

  return (
    <section className="pane">
      <div className="pane-head">
        <span className={`dot ${state?.status ?? 'starting'}`} />
        <span className="pane-title">{ENGINE_LABEL[engine]}</span>
        {errorCount > 0 && <span className="err-badge">{errorCount}</span>}
      </div>
      <div className="pane-screen" ref={screenRef}>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={engine}
          style={{ display: hasFrame ? 'block' : 'none' }}
          onPointerDown={(event) => {
            // 화면에 표시된 canvas 크기 ≠ 실제 엔진 뷰포트 크기이므로
            // 0~1로 정규화한 좌표를 보내고 서버 쪽에서 뷰포트 픽셀로 환산한다
            const rect = event.currentTarget.getBoundingClientRect();
            onSendCommand({
              type: 'click',
              x: (event.clientX - rect.left) / rect.width,
              y: (event.clientY - rect.top) / rect.height,
            });
          }}
        />
        {!hasFrame && (
          <div className="placeholder">
            {state?.status === 'error' ? `failed: ${state.detail ?? 'unknown'}` : 'starting…'}
          </div>
        )}
      </div>
    </section>
  );
}
