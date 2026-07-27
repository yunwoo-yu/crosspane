import { useCallback, useEffect, useRef, useState } from 'react';
import { ConsolePanel } from './components/ConsolePanel';
import { DiffPanel } from './components/DiffPanel';
import { EnginePane } from './components/EnginePane';
import { NetworkPanel } from './components/NetworkPanel';
import { Toolbar } from './components/Toolbar';
import { Button } from './components/ui/button';
import { ToastStack, useToasts } from './components/ui/toast';
import { ENGINE_SHORT_LABEL } from './constants';
import { useCrosspaneSocket } from './hooks/useCrosspaneSocket';
import { usePanelHeight } from './hooks/usePanelHeight';
import { countErrorsSinceLastNavigation, detectUrlDesync } from './log-utils';
import { buildReportHtml, downloadReport } from './report-utils';
import type { ClientCommand, EngineName } from './types';

export default function App() {
  const {
    connected,
    hello,
    engineStates,
    logs,
    networkEntries,
    sendCommand,
    clearLogs,
    subscribeToFrames,
  } = useCrosspaneSocket();
  const [bottomTab, setBottomTab] = useState<'console' | 'network' | 'diff'>('console');
  const { toasts, showToast } = useToasts();
  // pane 시작/중지에 즉각 피드백 — 실기기 부팅처럼 오래 걸리는 액션의 불안감 제거
  const sendCommandWithFeedback = useCallback(
    (command: ClientCommand) => {
      if (command.type === 'start-engine') {
        showToast(`${ENGINE_SHORT_LABEL[command.engine]} pane 시작 중…`);
      } else if (command.type === 'stop-engine') {
        showToast(`${ENGINE_SHORT_LABEL[command.engine]} pane을 닫았어요`);
      }
      sendCommand(command);
    },
    [sendCommand, showToast],
  );
  // pane canvas 레지스트리 — diff/리포트가 최신 프레임(canvas)에 직접 접근한다
  const paneCanvasesRef = useRef(new Map<EngineName, HTMLCanvasElement>());
  const registerCanvas = useCallback((engine: EngineName, canvas: HTMLCanvasElement | null) => {
    if (canvas) paneCanvasesRef.current.set(engine, canvas);
    else paneCanvasesRef.current.delete(engine);
  }, []);
  const getPaneCanvas = useCallback(
    (engine: EngineName) => paneCanvasesRef.current.get(engine) ?? null,
    [],
  );
  const { panelHeight, startPanelResize } = usePanelHeight();

  const errorCountFor = useCallback(
    (engine: EngineName) => countErrorsSinceLastNavigation(logs, engine),
    [logs],
  );

  const engineNames = hello?.engines ?? [];
  // pane은 실행 중(starting/running/error)인 엔진만 — 중지된 엔진은 그리드에서 빠지고
  // 툴바 토글로 다시 추가한다 (빈 슬롯이 공간을 차지하지 않도록)
  const activeEngines = engineNames.filter(
    (engine) => (engineStates[engine]?.status ?? 'stopped') !== 'stopped',
  );
  const helloViewOnly = hello?.viewOnlyEngines ?? [];
  // 세션이 확정한 값(셸 성공 시 ios-sim 인터랙티브) > hello의 초기 가정
  const isViewOnly = (engine: EngineName) =>
    engineStates[engine]?.viewOnly ?? helloViewOnly.includes(engine);
  // 포커스 모드: 한 pane만 크게. Esc로 해제
  const [focusedEngine, setFocusedEngine] = useState<EngineName | null>(null);
  // 포커스 중인 pane이 중지되면 포커스도 해제 (빈 화면에 갇히지 않도록)
  useEffect(() => {
    if (focusedEngine && !activeEngines.includes(focusedEngine)) setFocusedEngine(null);
  }, [focusedEngine, activeEngines]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFocusedEngine(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  // view-only 엔진(iOS 시뮬레이터)은 클릭을 따라가지 못해 URL이 뒤처지는 게 정상이고,
  // 중지된 엔진의 URL은 과거 값이다 — desync 판단은 실행 중 + 미러링 엔진끼리만 한다
  const mirroredStates = Object.fromEntries(
    Object.entries(engineStates).filter(
      ([engine]) =>
        activeEngines.includes(engine as EngineName) && !isViewOnly(engine as EngineName),
    ),
  );
  const urlDesynced = detectUrlDesync(mirroredStates);
  const syncTargetUrl = activeEngines
    .filter((engine) => !isViewOnly(engine))
    .map((engine) => engineStates[engine]?.currentUrl)
    .find((url) => Boolean(url));

  const errorLogCount = logs.filter((log) => log.level === 'error').length;

  const exportReport = useCallback(() => {
    if (!hello) return;
    const html = buildReportHtml({
      targetUrl: hello.url,
      device: hello.device,
      generatedAt: new Date(),
      engines: engineNames.map((engine) => ({
        engine,
        currentUrl: engineStates[engine]?.currentUrl,
        status: engineStates[engine]?.status,
        screenshotDataUrl: paneCanvasesRef.current.get(engine)?.toDataURL('image/jpeg', 0.8),
      })),
      logs,
      networkEntries,
    });
    downloadReport(html, hello.url);
    showToast('리포트를 저장했어요');
  }, [hello, engineNames, engineStates, logs, networkEntries, showToast]);

  return (
    <div className="app">
      <Toolbar
        connected={connected}
        hello={hello}
        engineStates={engineStates}
        urlDesynced={urlDesynced}
        syncTargetUrl={syncTargetUrl}
        onSendCommand={sendCommandWithFeedback}
        onClearLogs={clearLogs}
        onExportReport={exportReport}
      />

      <main
        className="grid"
        style={{
          // auto-fit: 좁은 창에서는 pane이 다음 줄로 흘러 내려간다 (5-pane 대응)
          gridTemplateColumns: focusedEngine ? '1fr' : 'repeat(auto-fit, minmax(340px, 1fr))',
          gridAutoRows: 'minmax(0, 1fr)',
        }}
      >
        {activeEngines.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 text-fg-muted">
            <span className="text-2xl">🪟</span>
            <span className="text-sm">실행 중인 pane이 없어요</span>
            <span className="text-xs">상단의 엔진 토글을 눌러 시작해 보세요</span>
          </div>
        )}
        {activeEngines.map((engine) => (
          <div
            key={engine}
            className={focusedEngine && focusedEngine !== engine ? 'pane-hidden' : 'pane-slot'}
          >
            <EnginePane
              engine={engine}
              visible={!focusedEngine || focusedEngine === engine}
              state={engineStates[engine]}
              errorCount={errorCountFor(engine)}
              urlDesynced={urlDesynced}
              viewOnly={isViewOnly(engine)}
              focused={focusedEngine === engine}
              onToggleFocus={() =>
                setFocusedEngine((current) => (current === engine ? null : engine))
              }
              onSendCommand={sendCommandWithFeedback}
              subscribeToFrames={subscribeToFrames}
              registerCanvas={registerCanvas}
            />
          </div>
        ))}
      </main>

      <section className="console" style={{ flexBasis: panelHeight }}>
        <div
          className="resize-handle"
          onPointerDown={startPanelResize}
          title="드래그로 패널 높이 조절"
        />
        <div className="flex items-center gap-1.5 border-line border-b px-4 py-2">
          <Button
            variant={bottomTab === 'console' ? 'active' : 'ghost'}
            size="icon"
            onClick={() => setBottomTab('console')}
          >
            Console
            {errorLogCount > 0 && (
              <span className="rounded-full bg-danger px-1.5 text-[10px] text-white leading-4">
                {errorLogCount}
              </span>
            )}
          </Button>
          <Button
            variant={bottomTab === 'network' ? 'active' : 'ghost'}
            size="icon"
            onClick={() => setBottomTab('network')}
          >
            Network
          </Button>
          <Button
            variant={bottomTab === 'diff' ? 'active' : 'ghost'}
            size="icon"
            onClick={() => setBottomTab('diff')}
          >
            Diff
          </Button>
        </div>
        {bottomTab === 'console' && <ConsolePanel logs={logs} engines={engineNames} />}
        {bottomTab === 'network' && <NetworkPanel entries={networkEntries} engines={engineNames} />}
        {bottomTab === 'diff' && (
          <DiffPanel engines={activeEngines} getPaneCanvas={getPaneCanvas} />
        )}
      </section>
      <ToastStack toasts={toasts} />
    </div>
  );
}
