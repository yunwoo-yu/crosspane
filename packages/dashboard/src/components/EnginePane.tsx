import { useEffect, useRef, useState } from 'react';
import { ENGINE_LABEL, WHEEL_COALESCE_MS } from '../constants';
import { toDisplayPath } from '../log-utils';
import type { ClientCommand, EngineName, EngineState, FrameListener } from '../types';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

interface EnginePaneProps {
  engine: EngineName;
  state: EngineState | undefined;
  errorCount: number;
  /** 엔진 간 URL이 어긋난 상태 — URL 표시를 경고색으로 바꾼다 */
  urlDesynced: boolean;
  /** 입력 미러링 불가 pane (예: iOS 시뮬레이터) — 입력 핸들러를 붙이지 않는다 */
  viewOnly: boolean;
  /** 포커스 모드: 이 pane만 크게 표시 */
  focused: boolean;
  /** 숨김 상태(다른 pane 포커스 중) — 프레임 구독을 끊어 디코드 비용을 없앤다 */
  visible: boolean;
  onToggleFocus: () => void;
  onSendCommand: (command: ClientCommand) => void;
  subscribeToFrames: (engine: EngineName, listener: FrameListener) => () => void;
}

/** 그대로 엔진에 전달할 특수 키 (나머지 단일 문자는 type 커맨드로 보낸다) */
const FORWARDED_SPECIAL_KEYS = new Set([
  'Enter',
  'Backspace',
  'Delete',
  'Tab',
  'Escape',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

// 이 시간 동안 휠 입력이 없으면 로컬 에코를 해제하고 실제 프레임 위치로 스냅한다
const ECHO_RELEASE_AFTER_MS = 400;

/** 로컬 에코 오프셋(엔진 CSS px)을 표시 px로 환산해 canvas에 적용한다 */
function applyEchoOffset(canvas: HTMLCanvasElement, offsetPx: number): void {
  if (canvas.height === 0) return;
  const clamped = Math.max(-canvas.height, Math.min(canvas.height, offsetPx));
  const displayScale = canvas.clientHeight / canvas.height;
  canvas.style.transform = clamped === 0 ? '' : `translateY(${-clamped * displayScale}px)`;
}

export function EnginePane({
  engine,
  state,
  errorCount,
  urlDesynced,
  viewOnly,
  focused,
  visible,
  onToggleFocus,
  onSendCommand,
  subscribeToFrames,
}: EnginePaneProps) {
  const screenRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onSendCommandRef = useRef(onSendCommand);
  onSendCommandRef.current = onSendCommand;
  const [hasFrame, setHasFrame] = useState(false);

  // 로컬 에코(스크롤 예측) 상태:
  // localTarget = 사용자가 의도한 scrollY, lastFrameScrollY = 프레임이 반영한 실제 scrollY.
  // 에코 오프셋 = localTarget - lastFrameScrollY → 프레임이 따라오면 자연스럽게 0으로 수렴한다.
  const localTargetRef = useRef<number | null>(null);
  const lastFrameScrollYRef = useRef<number | null>(null);
  const lastWheelTsRef = useRef(0);

  // 프레임은 React 상태를 거치지 않고 canvas에 직접 그린다 — 리렌더 비용 0.
  // 숨김 상태면 구독 자체를 끊는다 (canvas는 마지막 프레임을 유지하므로 안전)
  useEffect(() => {
    if (!visible) return;
    return subscribeToFrames(engine, (frame, scrollY) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (canvas.width !== frame.width || canvas.height !== frame.height) {
        canvas.width = frame.width;
        canvas.height = frame.height;
      }
      canvas.getContext('2d')?.drawImage(frame, 0, 0);
      setHasFrame(true); // 같은 값이면 React가 리렌더를 생략하므로 매 프레임 호출해도 무해

      if (scrollY < 0) {
        // 스크롤 위치를 모르는 프레임(ios-sim 등) — 에코 없이 그대로 표시
        canvas.style.transform = '';
        return;
      }
      lastFrameScrollYRef.current = scrollY;
      const target = localTargetRef.current;
      const wheelIdle = Date.now() - lastWheelTsRef.current > ECHO_RELEASE_AFTER_MS;
      if (target === null || wheelIdle || Math.abs(target - scrollY) < 2) {
        // 스크롤이 끝났거나 프레임이 목표를 따라잡음 — 실제 위치로 스냅
        localTargetRef.current = null;
        canvas.style.transform = '';
      } else {
        // 프레임이 아직 뒤에 있음 — 남은 차이만큼만 에코 유지 (고무줄 현상 방지)
        applyEchoOffset(canvas, target - scrollY);
      }
    });
  }, [engine, subscribeToFrames, visible]);

  // React의 onWheel은 passive라 preventDefault가 불가능하다.
  // 네이티브 non-passive 리스너로 대시보드 자체 스크롤을 막고(미러링 전용),
  // 델타를 WHEEL_COALESCE_MS 동안 모아 하나의 커맨드로 보낸다.
  // 로컬 에코: 서버 왕복을 기다리지 않고 canvas를 즉시 이동시켜 60fps 반응을 만든다.
  useEffect(() => {
    if (viewOnly) return;
    const screen = screenRef.current;
    if (!screen) return;
    let accumulatedDeltaY = 0;
    let flushTimer: number | null = null;

    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault();
      accumulatedDeltaY += event.deltaY;
      lastWheelTsRef.current = Date.now();

      const canvas = canvasRef.current;
      if (canvas) {
        if (localTargetRef.current === null) {
          localTargetRef.current = lastFrameScrollYRef.current ?? 0;
        }
        localTargetRef.current = Math.max(0, localTargetRef.current + event.deltaY);
        applyEchoOffset(canvas, localTargetRef.current - (lastFrameScrollYRef.current ?? 0));
      }

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
  }, [viewOnly]);

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
          title={focused ? '포커스 해제 (Esc)' : '이 pane만 크게'}
          onClick={onToggleFocus}
        >
          {focused ? '⤢' : '⤡'}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="이 pane 닫기 (엔진 중지, 툴바 토글로 재시작)"
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
        tabIndex={viewOnly ? -1 : 0}
        onKeyDown={(event) => {
          if (viewOnly) return;
          // OS/브라우저 단축키(cmd+r 등)는 대시보드에 남긴다
          if (event.metaKey || event.ctrlKey || event.altKey) return;
          if (FORWARDED_SPECIAL_KEYS.has(event.key)) {
            event.preventDefault();
            onSendCommand({ type: 'keypress', key: event.key });
          } else if (event.key.length === 1) {
            event.preventDefault();
            onSendCommand({ type: 'type', text: event.key });
          }
        }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={engine}
          style={{ display: hasFrame ? 'block' : 'none' }}
          onPointerDown={(event) => {
            if (viewOnly) return;
            // 클릭한 pane에 포커스를 줘서 이후 키 입력이 엔진으로 전달되게 한다
            screenRef.current?.focus();
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
