import { useCallback } from 'react';
import { ConsolePanel } from './components/ConsolePanel';
import { EnginePane } from './components/EnginePane';
import { Toolbar } from './components/Toolbar';
import { useCrosspaneSocket } from './hooks/useCrosspaneSocket';
import type { EngineName } from './types';

export default function App() {
  const { connected, hello, engineStates, logs, sendCommand, clearLogs, subscribeToFrames } =
    useCrosspaneSocket();

  const errorCountFor = useCallback(
    (engine: EngineName) =>
      logs.filter((log) => log.engine === engine && log.level === 'error').length,
    [logs],
  );

  const engineNames = hello?.engines ?? [];

  return (
    <div className="app">
      <Toolbar
        connected={connected}
        hello={hello}
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
            onSendCommand={sendCommand}
            subscribeToFrames={subscribeToFrames}
          />
        ))}
      </main>

      <ConsolePanel logs={logs} engines={engineNames} />
    </div>
  );
}
