import { useCallback, useEffect, useState } from 'react';
import { ConsolePanel } from './components/ConsolePanel';
import { EnginePane } from './components/EnginePane';
import { NetworkPanel } from './components/NetworkPanel';
import { Toolbar } from './components/Toolbar';
import { Button } from './components/ui/button';
import { useCrosspaneSocket } from './hooks/useCrosspaneSocket';
import { countErrorsSinceLastNavigation, detectUrlDesync } from './log-utils';
import type { EngineName } from './types';

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
  const [bottomTab, setBottomTab] = useState<'console' | 'network'>('console');
  // 하단 패널 높이 — 드래그 리사이즈, localStorage 유지
  const [panelHeight, setPanelHeight] = useState(() => {
    const saved = Number(localStorage.getItem('crosspane.panelHeight'));
    return Number.isFinite(saved) && saved >= 120 ? saved : 250;
  });
  const startPanelResize = (event: React.PointerEvent) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = panelHeight;
    const onMove = (move: PointerEvent) => {
      const next = Math.min(600, Math.max(120, startHeight + (startY - move.clientY)));
      setPanelHeight(next);
      localStorage.setItem('crosspane.panelHeight', String(next));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

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

  return (
    <div className="app">
      <Toolbar
        connected={connected}
        hello={hello}
        engineStates={engineStates}
        urlDesynced={urlDesynced}
        syncTargetUrl={syncTargetUrl}
        onSendCommand={sendCommand}
        onClearLogs={clearLogs}
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
          <div className="flex items-center justify-center text-fg-muted text-sm">
            실행 중인 pane 없음 — 상단 엔진 토글로 시작하세요
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
              onSendCommand={sendCommand}
              subscribeToFrames={subscribeToFrames}
            />
          </div>
        ))}
      </main>

      <section className="console" style={{ flexBasis: panelHeight }}>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: 패널 높이 드래그 핸들 */}
        <div
          className="h-1.5 shrink-0 cursor-row-resize bg-line/40 hover:bg-accent/60"
          onPointerDown={startPanelResize}
          title="드래그로 패널 높이 조절"
        />
        <div className="flex items-center gap-1 border-line border-b px-3 py-1">
          <Button
            variant="ghost"
            size="icon"
            className={bottomTab === 'console' ? 'border-accent text-fg' : ''}
            onClick={() => setBottomTab('console')}
          >
            Console
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={bottomTab === 'network' ? 'border-accent text-fg' : ''}
            onClick={() => setBottomTab('network')}
          >
            Network
          </Button>
        </div>
        {bottomTab === 'console' ? (
          <ConsolePanel logs={logs} engines={engineNames} />
        ) : (
          <NetworkPanel entries={networkEntries} engines={engineNames} />
        )}
      </section>
    </div>
  );
}
