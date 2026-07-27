import { ENGINE_LABEL } from '../constants';
import type { ClientMessage, EngineName, EngineState } from '../types';

interface EnginePaneProps {
  engine: EngineName;
  state: EngineState | undefined;
  errorCount: number;
  onSend: (msg: ClientMessage) => void;
}

export function EnginePane({ engine, state, errorCount, onSend }: EnginePaneProps) {
  return (
    <section className="pane">
      <div className="pane-head">
        <span className={`dot ${state?.status ?? 'starting'}`} />
        <span className="pane-title">{ENGINE_LABEL[engine]}</span>
        {errorCount > 0 && <span className="err-badge">{errorCount}</span>}
      </div>
      <div className="pane-screen">
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
            onWheel={(e) => onSend({ type: 'scroll', deltaY: e.deltaY })}
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
