import { useCallback } from 'react';
import { ConsolePanel } from './components/ConsolePanel';
import { EnginePane } from './components/EnginePane';
import { Toolbar } from './components/Toolbar';
import { useCrosspaneSocket } from './hooks/useCrosspaneSocket';
import type { EngineName } from './types';

export default function App() {
  const { connected, hello, engines, logs, send, clearLogs } = useCrosspaneSocket();

  const errorCount = useCallback(
    (engine: EngineName) => logs.filter((l) => l.engine === engine && l.level === 'error').length,
    [logs],
  );

  const engineNames = hello?.engines ?? [];

  return (
    <div className="app">
      <Toolbar connected={connected} hello={hello} onSend={send} onClearLogs={clearLogs} />

      <main
        className="grid"
        style={{ gridTemplateColumns: `repeat(${Math.max(engineNames.length, 1)}, 1fr)` }}
      >
        {engineNames.map((engine) => (
          <EnginePane
            key={engine}
            engine={engine}
            state={engines[engine]}
            errorCount={errorCount(engine)}
            onSend={send}
          />
        ))}
      </main>

      <ConsolePanel logs={logs} engines={engineNames} />
    </div>
  );
}
