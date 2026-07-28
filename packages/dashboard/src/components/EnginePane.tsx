import { memo } from 'react';
import { ENGINE_LABEL } from '../constants';
import { usePaneMirroring } from '../hooks/usePaneMirroring';
import { toDisplayPath } from '../log-utils';
import type { ClientCommand, EngineName, EngineState, FrameListener } from '../types';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

interface EnginePaneProps {
  engine: EngineName;
  /** 엔진 뷰포트 (CSS px) — hello에서 전달 */
  viewport: { width: number; height: number };
  state: EngineState | undefined;
  errorCount: number;
  /** 엔진 간 URL이 어긋난 상태 — URL 표시를 경고색으로 바꾼다 */
  urlDesynced: boolean;
  /** 입력 미러링 불가 pane (예: Safari 폴백) — 입력 핸들러를 붙이지 않는다 */
  viewOnly: boolean;
  /** 포커스 모드: 이 pane만 크게 표시 */
  focused: boolean;
  /** 숨김 상태(다른 pane 포커스 중) — 프레임 구독을 끊어 디코드 비용을 없앤다 */
  visible: boolean;
  onToggleFocus: () => void;
  onSendCommand: (command: ClientCommand) => void;
  subscribeToFrames: (engine: EngineName, listener: FrameListener) => () => void;
  /** diff/리포트가 pane의 원본 canvas에 접근할 수 있도록 등록 (프레임은 상태에 없다) */
  registerCanvas?: (engine: EngineName, canvas: HTMLCanvasElement | null) => void;
}

/**
 * 엔진 pane 카드 — 미러링 로직은 전부 usePaneMirroring에 있고,
 * 이 컴포넌트는 헤더/상태 표시와 마크업만 담당한다.
 * memo: 프레임은 상태를 안 거치므로 로그 폭주(초당 ~20렌더) 시 props가 같은
 * pane의 리렌더를 건너뛴다 — App 쪽 파생값 useMemo가 전제 조건이다.
 */
export const EnginePane = memo(function EnginePane({
  engine,
  viewport,
  state,
  errorCount,
  urlDesynced,
  viewOnly,
  focused,
  visible,
  onToggleFocus,
  onSendCommand,
  subscribeToFrames,
  registerCanvas,
}: EnginePaneProps) {
  const { screenRef, keyInputRef, attachCanvas, hasFrame, canvasHandlers, keyInputHandlers } =
    usePaneMirroring({
      engine,
      viewport,
      visible,
      viewOnly,
      subscribeToFrames,
      sendCommand: onSendCommand,
      registerCanvas,
    });

  return (
    <section className="pane">
      <div className="pane-head">
        <span className={`dot ${state?.status ?? 'starting'}`} />
        <span className="pane-title">{ENGINE_LABEL[engine]}</span>
        {viewOnly && <Badge variant="outline">view-only</Badge>}
        {state?.currentUrl && (
          <span className={`pane-url ${urlDesynced ? 'desynced' : ''}`} title={state.currentUrl}>
            {toDisplayPath(state.currentUrl)}
          </span>
        )}
        {errorCount > 0 && <Badge variant="destructive">{errorCount}</Badge>}
        <Button
          variant="ghost"
          size="icon"
          title={focused ? 'Exit focus (Esc)' : 'Focus this pane'}
          onClick={onToggleFocus}
        >
          {focused ? '⤢' : '⤡'}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="Close this pane (stops the engine; restart from the toolbar toggle)"
          onClick={() => onSendCommand({ type: 'stop-engine', engine })}
        >
          ✕
        </Button>
      </div>
      <div
        className="pane-screen"
        ref={screenRef}
        // 원격 화면 위젯: 키 입력을 AT가 아니라 앱(엔진 미러링)이 처리한다
        role="application"
        aria-label={`${engine} screen`}
      >
        {/* 키 입력은 숨김 input이 받는다 — 브라우저 IME(한글 조합)를 그대로 활용해
            조합이 끝난 텍스트만 엔진으로 보내기 위함 */}
        {!viewOnly && (
          <input
            ref={keyInputRef}
            className="sr-only"
            aria-label={`${engine} keyboard input`}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            {...keyInputHandlers}
          />
        )}
        {/* 대상 서버 연결 실패 — 빈 화면 대신 원인과 해법을 보여준다 */}
        {state?.currentUrl?.startsWith('chrome-error://') && (
          <div className="absolute inset-x-0 top-0 z-10 bg-danger/15 px-4 py-2 text-center text-danger text-xs">
            Can't reach the target server — start your dev server, then hit ⟳
          </div>
        )}
        <canvas
          ref={attachCanvas}
          role="img"
          aria-label={engine}
          style={{ display: hasFrame ? 'block' : 'none' }}
          {...canvasHandlers}
        />
        {!hasFrame && (
          <div className="placeholder">
            {state?.status === 'error' ? (
              `failed: ${state.detail ?? 'unknown'}`
            ) : (
              <>
                <span className="spinner" aria-hidden="true" />
                <span>starting…</span>
                {(engine === 'android' || engine === 'ios-sim') && (
                  <span className="text-[11px] text-fg-muted">
                    Real-device boot can take 1–2 minutes
                  </span>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
});
