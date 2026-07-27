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

  const errorCountFor = useCallback(
    (engine: EngineName) => countErrorsSinceLastNavigation(logs, engine),
    [logs],
  );

  const engineNames = hello?.engines ?? [];
  const helloViewOnly = hello?.viewOnlyEngines ?? [];
  // 세션이 확정한 값(셸 성공 시 ios-sim 인터랙티브) > hello의 초기 가정
  const isViewOnly = (engine: EngineName) =>
    engineStates[engine]?.viewOnly ?? helloViewOnly.includes(engine);
  // 포커스 모드: 한 pane만 크게. Esc로 해제
  const [focusedEngine, setFocusedEngine] = useState<EngineName | null>(null);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFocusedEngine(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  // view-only 엔진(iOS 시뮬레이터)은 클릭을 따라가지 못해 URL이 뒤처지는 게 정상 —
  // desync 판단은 미러링되는 엔진끼리만 한다
  const mirroredStates = Object.fromEntries(
    Object.entries(engineStates).filter(([engine]) => !isViewOnly(engine as EngineName)),
  );
  const urlDesynced = detectUrlDesync(mirroredStates);
  const syncTargetUrl = engineNames
    .filter((engine) => !isViewOnly(engine))
    .map((engine) => engineStates[engine]?.currentUrl)
    .find((url) => Boolean(url));

  return (
    <div className="app">
      <Toolbar
        connected={connected}
        hello={hello}
        urlDesynced={urlDesynced}
        syncTargetUrl={syncTargetUrl}
        onSendCommand={sendCommand}
        onClearLogs={clearLogs}
      />

      <main
        className="grid"
        style={{
          gridTemplateColumns: focusedEngine
            ? '1fr'
            : `repeat(${Math.max(engineNames.length, 1)}, 1fr)`,
        }}
      >
        {engineNames.map((engine) => (
          <div
            key={engine}
            className={focusedEngine && focusedEngine !== engine ? 'pane-hidden' : 'pane-slot'}
          >
            <EnginePane
              engine={engine}
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

      <section className="console">
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
