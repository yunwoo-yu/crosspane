import { useEffect, useState } from 'react';
import { normalizeUrlInput } from '../log-utils';
import type { ClientCommand, HelloEvent } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';

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
  const [urlInput, setUrlInput] = useState('');

  // 최초 hello 도착 시 URL 바를 타깃 주소로 채운다
  useEffect(() => {
    if (hello) setUrlInput(hello.url);
  }, [hello]);

  return (
    <header className="toolbar">
      <span className="brand">crosspane</span>
      <span className={`conn ${connected ? 'on' : 'off'}`}>
        {connected ? 'connected' : 'disconnected'}
      </span>
      <form
        className="url-bar max-w-md flex-1"
        onSubmit={(event) => {
          event.preventDefault();
          if (urlInput.trim()) {
            onSendCommand({ type: 'navigate', url: normalizeUrlInput(urlInput) });
          }
        }}
      >
        <Input
          type="text"
          value={urlInput}
          onChange={(event) => setUrlInput(event.target.value)}
          placeholder=":3000 또는 URL"
          aria-label="navigate all engines"
          spellCheck={false}
        />
      </form>
      {hello && <span className="device">{hello.device}</span>}
      {urlDesynced && syncTargetUrl && (
        <Button
          variant="warn"
          title={`모든 엔진을 ${syncTargetUrl}로 이동`}
          onClick={() => onSendCommand({ type: 'navigate', url: syncTargetUrl })}
        >
          ⚠ URL 어긋남 — 재동기화
        </Button>
      )}
      <Button className="ml-auto" onClick={() => onSendCommand({ type: 'back' })} title="뒤로가기">
        ←
      </Button>
      <Button onClick={() => onSendCommand({ type: 'forward' })} title="앞으로가기">
        →
      </Button>
      <Button onClick={() => onSendCommand({ type: 'reload' })}>⟳ reload all</Button>
      <Button variant="ghost" onClick={onClearLogs}>
        clear logs
      </Button>
    </header>
  );
}
