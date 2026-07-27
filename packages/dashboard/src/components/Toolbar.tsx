import { useEffect, useState } from 'react';
import { ENGINE_SHORT_LABEL } from '../constants';
import { cn } from '../lib/cn';
import { normalizeUrlInput } from '../log-utils';
import type { ClientCommand, EngineName, EngineState, HelloEvent } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';

interface ToolbarProps {
  connected: boolean;
  hello: HelloEvent | null;
  engineStates: Partial<Record<EngineName, EngineState>>;
  /** 엔진 간 URL이 어긋난 상태 — 재동기화 버튼을 노출한다 */
  urlDesynced: boolean;
  /** 재동기화 기준 URL (첫 번째 엔진의 현재 URL) */
  syncTargetUrl: string | undefined;
  onSendCommand: (command: ClientCommand) => void;
  onClearLogs: () => void;
  /** 현재 상태(스크린샷/로그/네트워크)를 단일 HTML 리포트로 다운로드 */
  onExportReport: () => void;
}

export function Toolbar({
  connected,
  hello,
  engineStates,
  urlDesynced,
  syncTargetUrl,
  onSendCommand,
  onClearLogs,
  onExportReport,
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
      {/* 엔진 pane 토글 — 클릭으로 pane 추가/제거. 실기기 pane은 부팅에 시간이 걸린다 */}
      <fieldset className="m-0 flex items-center gap-1 border-0 p-0" aria-label="engine panes">
        {(hello?.engines ?? []).map((engine) => {
          const status = engineStates[engine]?.status ?? 'stopped';
          const active = status !== 'stopped';
          return (
            <Button
              key={engine}
              variant="ghost"
              size="icon"
              className={cn('gap-1.5', active && 'border-accent text-fg')}
              title={active ? `${engine} pane 중지 (리소스 반환)` : `${engine} pane 시작`}
              aria-pressed={active}
              onClick={() =>
                onSendCommand({ type: active ? 'stop-engine' : 'start-engine', engine })
              }
            >
              <span className={`dot ${status}`} />
              {ENGINE_SHORT_LABEL[engine]}
            </Button>
          );
        })}
      </fieldset>
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
      <Button
        variant="ghost"
        title="스크린샷+로그+네트워크를 단일 HTML로 저장"
        onClick={onExportReport}
      >
        ⤓ report
      </Button>
    </header>
  );
}
