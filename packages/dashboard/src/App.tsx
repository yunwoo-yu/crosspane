import { useCallback, useMemo, useRef, useState } from 'react';
import { CaptureParseError, type LoadedCapture, parseCaptureFile } from './capture-file';
import { ConsolePanel } from './components/ConsolePanel';
import { NetworkPanel } from './components/NetworkPanel';
import { SessionList } from './components/SessionList';
import { Button } from './components/ui/button';
import { ToastStack, useToasts } from './components/ui/toast';
import { useCrosspaneSocket } from './hooks/useCrosspaneSocket';
import { usePanelHeight } from './hooks/usePanelHeight';
import type { LogEntry, NetworkEntry, SessionMeta } from './types';

export default function App() {
  const { connected, sessions, sessionStates, logs, networkEntries, clearLogs } =
    useCrosspaneSocket();
  const [bottomTab, setBottomTab] = useState<'console' | 'network'>('console');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** 리플레이 모드: 파일을 열면 라이브 스트림 대신 이 캡처를 본다 */
  const [replay, setReplay] = useState<LoadedCapture | null>(null);
  const { toasts, showToast } = useToasts();
  const { panelHeight, startPanelResize } = usePanelHeight();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadCaptureFile = useCallback(
    async (file: File) => {
      try {
        const loaded = parseCaptureFile(await file.text());
        setReplay(loaded);
        setSelectedId(null);
        showToast(`Replaying ${loaded.session.label} (${loaded.logs.length} logs)`);
      } catch (err) {
        showToast(err instanceof CaptureParseError ? err.message : 'Could not read that file');
      }
    },
    [showToast],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const file = event.dataTransfer.files[0];
      if (file) void loadCaptureFile(file);
    },
    [loadCaptureFile],
  );

  // 라이브/리플레이가 같은 패널을 쓰도록 여기서 소스만 바꾼다
  const view: { sessions: SessionMeta[]; logs: LogEntry[]; networkEntries: NetworkEntry[] } =
    useMemo(() => {
      if (replay) {
        return {
          sessions: [replay.session],
          logs: replay.logs,
          networkEntries: replay.networkEntries,
        };
      }
      return { sessions: Object.values(sessions), logs, networkEntries };
    }, [replay, sessions, logs, networkEntries]);

  const visibleLogs = useMemo(
    () => (selectedId ? view.logs.filter((log) => log.sessionId === selectedId) : view.logs),
    [view.logs, selectedId],
  );
  const visibleNetwork = useMemo(
    () =>
      selectedId
        ? view.networkEntries.filter((entry) => entry.sessionId === selectedId)
        : view.networkEntries,
    [view.networkEntries, selectedId],
  );
  const errorLogCount = useMemo(
    () => visibleLogs.filter((log) => log.level === 'error').length,
    [visibleLogs],
  );

  const hasSessions = view.sessions.length > 0;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 드롭 영역은 파일 입력 버튼으로도 동일 기능 제공
    <div className="app" onDrop={onDrop} onDragOver={(event) => event.preventDefault()}>
      <header className="flex items-center gap-2 border-line border-b px-4 py-2">
        <span className="font-semibold">crosspane</span>
        {replay ? (
          <>
            <span className="rounded bg-warn/20 px-2 py-0.5 text-warn text-xs">replay</span>
            <Button variant="ghost" size="icon" onClick={() => setReplay(null)}>
              Back to live
            </Button>
          </>
        ) : (
          <span className={`text-xs ${connected ? 'text-emerald-400' : 'text-fg-muted'}`}>
            {connected ? 'hub connected' : 'connecting…'}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            aria-label="open capture file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void loadCaptureFile(file);
              event.target.value = '';
            }}
          />
          <Button variant="ghost" size="icon" onClick={() => fileInputRef.current?.click()}>
            Open capture…
          </Button>
          {!replay && (
            <Button variant="ghost" size="icon" onClick={clearLogs}>
              Clear
            </Button>
          )}
        </div>
      </header>

      <SessionList
        sessions={view.sessions}
        states={replay ? { [replay.session.id]: { live: false, errorCount: 0 } } : sessionStates}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />

      {!hasSessions && (
        <main className="flex flex-1 flex-col items-center justify-center gap-2 text-fg-muted">
          <span className="text-2xl">🛰️</span>
          <span className="text-sm">No sessions yet</span>
          <span className="max-w-md text-center text-xs">
            Add <code className="text-fg">@crosspane/agent</code> to your app and point it at this
            hub, or drop a <code className="text-fg">.crosspane.json</code> capture file here to
            replay it.
          </span>
        </main>
      )}

      <section className="console" style={{ flexBasis: hasSessions ? undefined : panelHeight }}>
        {hasSessions && (
          <div
            className="resize-handle"
            onPointerDown={startPanelResize}
            title="Drag to resize panel"
          />
        )}
        <div className="flex items-center gap-1.5 border-line border-b px-4 py-2">
          <Button
            variant={bottomTab === 'console' ? 'active' : 'ghost'}
            size="icon"
            className="px-2.5"
            onClick={() => setBottomTab('console')}
          >
            Console
            {errorLogCount > 0 && (
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 font-semibold text-[10px] text-white leading-none">
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
        </div>
        {bottomTab === 'console' && <ConsolePanel logs={visibleLogs} sessions={view.sessions} />}
        {bottomTab === 'network' && (
          <NetworkPanel entries={visibleNetwork} sessions={view.sessions} />
        )}
      </section>
      <ToastStack toasts={toasts} />
    </div>
  );
}
