import { useCallback, useMemo, useRef, useState } from 'react';
import { CaptureParseError, type LoadedCapture, parseCaptureFile } from './capture-file';
import { ConnectHint } from './components/ConnectHint';
import { ConsolePanel } from './components/ConsolePanel';
import { LocaleToggle } from './components/LocaleToggle';
import { NetworkPanel } from './components/NetworkPanel';
import { ScreenPanel } from './components/ScreenPanel';
import { SessionList } from './components/SessionList';
import { TimelinePanel } from './components/TimelinePanel';
import { Button } from './components/ui/button';
import { ToastStack, useToasts } from './components/ui/toast';
import { useCrosspaneSocket } from './hooks/useCrosspaneSocket';
import { useLocale } from './hooks/useLocale';
import { withHubToken } from './hub-token';
import type { LogEntry, NetworkEntry, SessionMeta } from './types';

export default function App() {
  const {
    connected,
    failedAttempts,
    hubUrl,
    sessions,
    sessionStates,
    logs,
    networkEntries,
    screenEvents,
    clearLogs,
  } = useCrosspaneSocket();
  const { t } = useLocale();
  /**
   * 기본이 타임라인인 이유: 대부분의 디버깅은 "무슨 일이 있었나"에서 시작한다.
   * 콘솔·네트워크 탭은 그 다음에 깊이 파는 곳이다.
   */
  const [bottomTab, setBottomTab] = useState<'timeline' | 'console' | 'network' | 'screen'>(
    'timeline',
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** 리플레이 모드: 파일을 열면 라이브 스트림 대신 이 캡처를 본다 */
  const [replay, setReplay] = useState<LoadedCapture | null>(null);
  const { toasts, showToast } = useToasts();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadCaptureFile = useCallback(
    async (file: File) => {
      try {
        const loaded = parseCaptureFile(await file.text());
        setReplay(loaded);
        setSelectedId(null);
        showToast(t.replayingToast(loaded.session.label, loaded.logs.length));
      } catch (err) {
        showToast(err instanceof CaptureParseError ? err.message : t.fileReadFailed);
      }
    },
    [showToast, t],
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
  const view: {
    sessions: SessionMeta[];
    logs: LogEntry[];
    networkEntries: NetworkEntry[];
    screenEvents: Record<string, unknown[]>;
  } = useMemo(() => {
    if (replay) {
      return {
        sessions: [replay.session],
        logs: replay.logs,
        networkEntries: replay.networkEntries,
        screenEvents: { [replay.session.id]: replay.screenEvents },
      };
    }
    return { sessions: Object.values(sessions), logs, networkEntries, screenEvents };
  }, [replay, sessions, logs, networkEntries, screenEvents]);

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
  // 화면 탭은 선택된 세션(없으면 기록이 있는 첫 세션)의 것을 보여준다
  const visibleScreenEvents = useMemo(() => {
    if (selectedId) return view.screenEvents[selectedId] ?? [];
    return Object.values(view.screenEvents).find((events) => events.length > 0) ?? [];
  }, [view.screenEvents, selectedId]);
  const errorLogCount = useMemo(
    () => visibleLogs.filter((log) => log.level === 'error').length,
    [visibleLogs],
  );

  const hasSessions = view.sessions.length > 0;
  // 저장 대상: 선택된 세션, 없으면 유일한 세션일 때만 (여러 개면 무엇을 저장할지 모호하다)
  const savableSessionId = selectedId ?? (view.sessions.length === 1 ? view.sessions[0].id : null);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 드롭 영역은 파일 입력 버튼으로도 동일 기능 제공
    <div className="app" onDrop={onDrop} onDragOver={(event) => event.preventDefault()}>
      <header className="flex items-center gap-2 border-line border-b px-4 py-2">
        <span className="shrink-0 font-semibold">{t.appTitle}</span>
        {replay ? (
          <>
            <span className="rounded bg-warn/20 px-2 py-0.5 text-warn text-xs">{t.replay}</span>
            {replay.droppedEvents > 0 && (
              // 상한으로 앞부분이 잘린 파일임을 밝힌다 — 조용히 두면 전량으로 오해한다
              <span className="text-fg-muted text-xs" title={t.droppedTitle}>
                {t.earlierDropped(replay.droppedEvents.toLocaleString())}
              </span>
            )}
            <Button variant="ghost" size="icon" onClick={() => setReplay(null)}>
              {t.backToLive}
            </Button>
          </>
        ) : (
          <span
            /* truncate: 좁은 화면에서 "hub connected"가 두 줄로 접히며 헤더 높이를
               키우던 것을 막는다 — 상태는 색으로도 읽힌다 */
            className={`min-w-0 truncate text-xs ${connected ? 'text-emerald-400' : 'text-fg-muted'}`}
            /* 몇 번 실패하면 어디로 붙으려는지 보여준다 — 인증서 이름 불일치처럼
               흔한 원인은 주소를 봐야만 알 수 있고, 그 전까지는 그냥 connecting…이다 */
            title={connected ? undefined : hubUrl}
          >
            {connected
              ? t.hubConnected
              : `${t.connecting}${failedAttempts > 2 ? ` (${hubUrl})` : ''}`}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1.5 [&_button]:whitespace-nowrap">
          <LocaleToggle />
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            aria-label={t.openCaptureLabel}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void loadCaptureFile(file);
              event.target.value = '';
            }}
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => fileInputRef.current?.click()}
            title={t.openCapture}
          >
            <span className="hidden sm:inline">{t.openCapture}</span>
            <span className="sm:hidden">{t.openCaptureShort}</span>
          </Button>
          {!replay && savableSessionId && (
            // 허브가 원본 이벤트로 파일을 만든다 — 표시용 엔트리를 역변환하지 않는다
            <a
              href={withHubToken(`/capture/${savableSessionId}`)}
              download
              className="whitespace-nowrap rounded px-2 py-1 text-fg-muted text-xs hover:bg-panel hover:text-fg"
            >
              ⤓ <span className="hidden sm:inline">{t.saveSession}</span>
              <span className="sm:hidden">{t.saveSessionShort}</span>
            </a>
          )}
          {!replay && (
            <Button variant="ghost" size="icon" onClick={clearLogs}>
              {t.clear}
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

      {hasSessions ? null : (
        <main className="flex flex-1 flex-col items-center justify-center gap-2 text-fg-muted">
          <span className="text-2xl">🛰️</span>
          <span className="text-sm">{t.noSessions}</span>
          <span className="max-w-md text-center text-xs">{t.emptyStateHint}</span>
          {!replay && <ConnectHint />}
        </main>
      )}

      {/* 세션이 없을 때 빈 필터 바와 빈 로그 영역을 함께 보여줄 이유가 없다 —
          빈 상태 안내가 화면을 온전히 쓰게 둔다 */}
      {hasSessions && (
        <section className="console">
          <div className="flex items-center gap-1.5 border-line border-b px-4 py-2">
            <Button
              variant={bottomTab === 'timeline' ? 'active' : 'ghost'}
              size="icon"
              className="px-2.5"
              onClick={() => setBottomTab('timeline')}
            >
              {t.tabTimeline}
              {/* 에러 배지는 여기에만 둔다 — 기본으로 열리는 탭이고, 두 곳에 같은 숫자가
                  뜨면 서로 다른 것을 세는 줄 알게 된다 */}
              {errorLogCount > 0 && (
                <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 font-semibold text-[10px] text-white leading-none">
                  {errorLogCount}
                </span>
              )}
            </Button>
            <Button
              variant={bottomTab === 'console' ? 'active' : 'ghost'}
              size="icon"
              className="px-2.5"
              onClick={() => setBottomTab('console')}
            >
              {t.tabConsole}
            </Button>
            <Button
              variant={bottomTab === 'network' ? 'active' : 'ghost'}
              size="icon"
              onClick={() => setBottomTab('network')}
            >
              {t.tabNetwork}
            </Button>
            <Button
              variant={bottomTab === 'screen' ? 'active' : 'ghost'}
              size="icon"
              onClick={() => setBottomTab('screen')}
            >
              {t.tabScreen}
              {visibleScreenEvents.length > 0 && (
                <span className="ml-1 h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
              )}
            </Button>
          </div>
          {bottomTab === 'timeline' && (
            <TimelinePanel logs={visibleLogs} network={visibleNetwork} />
          )}
          {bottomTab === 'console' && <ConsolePanel logs={visibleLogs} />}
          {bottomTab === 'network' && (
            <NetworkPanel entries={visibleNetwork} sessions={view.sessions} />
          )}
          {bottomTab === 'screen' && <ScreenPanel events={visibleScreenEvents} />}
        </section>
      )}
      <ToastStack toasts={toasts} />
    </div>
  );
}
