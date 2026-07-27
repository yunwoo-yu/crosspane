import type { ClientMessage, HelloMessage } from '../types';

interface ToolbarProps {
  connected: boolean;
  hello: HelloMessage | null;
  onSend: (msg: ClientMessage) => void;
  onClearLogs: () => void;
}

export function Toolbar({ connected, hello, onSend, onClearLogs }: ToolbarProps) {
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
      <button type="button" onClick={() => onSend({ type: 'reload' })}>
        ⟳ reload all
      </button>
      <button type="button" onClick={onClearLogs}>
        clear logs
      </button>
    </header>
  );
}
