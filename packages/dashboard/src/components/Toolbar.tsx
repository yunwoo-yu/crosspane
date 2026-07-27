import type { ClientCommand, HelloEvent } from '../types';

interface ToolbarProps {
  connected: boolean;
  hello: HelloEvent | null;
  /** 엔진 간 URL이 어긋난 상태 — 재동기화 버튼을 노출한다 */
  urlDesynced: boolean;
  /** 재동기화 기준 URL (첫 번째 엔진의 현재 URL) */
  syncTargetUrl: string | undefined;
  onSendCommand: (command: ClientCommand) => void;
  onClearLogs: () => void;
}

export function Toolbar({
  connected,
  hello,
  urlDesynced,
  syncTargetUrl,
  onSendCommand,
  onClearLogs,
}: ToolbarProps) {
  return (
    <header className="toolbar">
      <span className="brand">crosspane</span>
      <span className={`conn ${connected ? 'on' : 'off'}`}>
        {connected ? 'connected' : 'disconnected'}
      </span>
      {hello && (
        <>
          <span className="target">{hello.url}</span>
          <span className="device">{hello.device}</span>
        </>
      )}
      {urlDesynced && syncTargetUrl && (
        <button
          type="button"
          className="sync-warning"
          title={`모든 엔진을 ${syncTargetUrl}로 이동`}
          onClick={() => onSendCommand({ type: 'navigate', url: syncTargetUrl })}
        >
          ⚠ URL 어긋남 — 재동기화
        </button>
      )}
      <button type="button" onClick={() => onSendCommand({ type: 'back' })} title="뒤로가기">
        ←
      </button>
      <button type="button" onClick={() => onSendCommand({ type: 'forward' })} title="앞으로가기">
        →
      </button>
      <button type="button" onClick={() => onSendCommand({ type: 'reload' })}>
        ⟳ reload all
      </button>
      <button type="button" onClick={onClearLogs}>
        clear logs
      </button>
    </header>
  );
}
