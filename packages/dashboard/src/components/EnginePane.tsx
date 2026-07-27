import { useEffect, useRef } from 'react';
import { ENGINE_LABEL, WHEEL_FLUSH_MS } from '../constants';
import type { ClientMessage, EngineName, EngineState } from '../types';

interface EnginePaneProps {
  engine: EngineName;
  state: EngineState | undefined;
  errorCount: number;
  onSend: (msg: ClientMessage) => void;
}

export function EnginePane({ engine, state, errorCount, onSend }: EnginePaneProps) {
  const screenRef = useRef<HTMLDivElement | null>(null);
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;

  // React의 onWheel은 passive라 preventDefault가 불가능하다.
  // 네이티브 non-passive 리스너로 대시보드 자체 스크롤을 막고(미러링 전용),
  // 델타를 WHEEL_FLUSH_MS 동안 모아 하나의 메시지로 보낸다.
  useEffect(() => {
    const el = screenRef.current;
    if (!el) return;
    let accum = 0;
    let timer: number | null = null;

    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      accum += e.deltaY;
      if (timer === null) {
        timer = window.setTimeout(() => {
          const deltaY = Math.round(accum);
          accum = 0;
          timer = null;
          if (deltaY !== 0) onSendRef.current({ type: 'scroll', deltaY });
        }, WHEEL_FLUSH_MS);
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (timer !== null) window.clearTimeout(timer);
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
        {state?.frame ? (
          <img
            src={`data:image/jpeg;base64,${state.frame}`}
            alt={engine}
            draggable={false}
            onPointerDown={(e) => {
              // 화면에 표시된 이미지 크기 ≠ 실제 엔진 뷰포트 크기이므로
              // 0~1로 정규화한 좌표를 보내고 서버 쪽에서 뷰포트 픽셀로 환산한다
              const rect = e.currentTarget.getBoundingClientRect();
              onSend({
                type: 'click',
                x: (e.clientX - rect.left) / rect.width,
                y: (e.clientY - rect.top) / rect.height,
              });
            }}
          />
        ) : (
          <div className="placeholder">
            {state?.status === 'error' ? `failed: ${state.detail ?? 'unknown'}` : 'starting…'}
          </div>
        )}
      </div>
    </section>
  );
}
