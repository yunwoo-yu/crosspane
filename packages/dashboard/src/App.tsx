import { useCallback } from 'react';
import { ConsolePanel } from './components/ConsolePanel';
import { EnginePane } from './components/EnginePane';
import { Toolbar } from './components/Toolbar';
import { useCrosspaneSocket } from './hooks/useCrosspaneSocket';
import { countErrorsSinceLastNavigation, detectUrlDesync } from './log-utils';
import type { EngineName } from './types';

export default function App() {
  const { connected, hello, engineStates, logs, sendCommand, clearLogs, subscribeToFrames } =
    useCrosspaneSocket();

  const errorCountFor = useCallback(
    (engine: EngineName) => countErrorsSinceLastNavigation(logs, engine),
    [logs],
  );

  const engineNames = hello?.engines ?? [];
  const urlDesynced = detectUrlDesync(engineStates);
  const syncTargetUrl = engineNames
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
        style={{ gridTemplateColumns: `repeat(${Math.max(engineNames.length, 1)}, 1fr)` }}
      >
        {engineNames.map((engine) => (
          <EnginePane
            key={engine}
            engine={engine}
            state={engineStates[engine]}
            errorCount={errorCountFor(engine)}
            urlDesynced={urlDesynced}
            onSendCommand={sendCommand}
            subscribeToFrames={subscribeToFrames}
          />
        ))}
      </main>

      <ConsolePanel logs={logs} engines={engineNames} />
    </div>
  );
}
