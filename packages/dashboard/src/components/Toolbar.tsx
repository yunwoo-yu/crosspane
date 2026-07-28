import { useEffect, useState } from 'react';
import { ENGINE_SHORT_LABEL } from '../constants';
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
  // 입력 중에는 자동 갱신으로 타이핑을 덮어쓰지 않는다
  const [editing, setEditing] = useState(false);

  // 최초 hello 도착 시 URL 바를 타깃 주소로 채운다
  useEffect(() => {
    if (hello) setUrlInput(hello.url);
  }, [hello]);

  // 실무 QA 동선: 클릭으로 페이지를 옮겨 다니면 주소창이 현재 위치를 따라간다.
  // 에러 페이지 내부 URL(chrome-error:// 등)은 사용자가 갈 곳이 아니므로 제외
  useEffect(() => {
    if (!editing && syncTargetUrl?.startsWith('http')) setUrlInput(syncTargetUrl);
  }, [syncTargetUrl, editing]);

  return (
    <header className="toolbar">
      <span className="brand">crosspane</span>
      <span className={`conn ${connected ? 'on' : 'off'}`}>
        {connected ? 'connected' : 'disconnected'}
      </span>
      {/* 엔진 pane 토글 — 클릭으로 pane 추가/제거. 실기기 pane은 부팅에 시간이 걸린다 */}
      <fieldset className="m-0 flex items-center gap-1.5 border-0 p-0" aria-label="engine panes">
        {(hello?.engines ?? []).map((engine) => {
          const status = engineStates[engine]?.status ?? 'stopped';
          const active = status !== 'stopped';
          return (
            <Button
              key={engine}
              variant={active ? 'active' : 'ghost'}
              size="icon"
              className="gap-1.5"
              title={active ? `Stop ${engine} pane (frees resources)` : `Start ${engine} pane`}
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
          onFocus={() => setEditing(true)}
          onBlur={() => setEditing(false)}
          placeholder=":3000 or URL"
          aria-label="navigate all engines"
          spellCheck={false}
        />
      </form>
      {hello && <span className="device">{hello.device}</span>}
      {urlDesynced && syncTargetUrl && (
        <Button
          variant="warn"
          title={`Navigate all engines to ${syncTargetUrl}`}
          onClick={() => onSendCommand({ type: 'navigate', url: syncTargetUrl })}
        >
          ⚠ URLs diverged — resync
        </Button>
      )}
      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onSendCommand({ type: 'back' })}
          title="Back"
        >
          ←
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onSendCommand({ type: 'forward' })}
          title="Forward"
        >
          →
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onSendCommand({ type: 'reload' })}
          title="Reload all engines"
        >
          ⟳
        </Button>
        <span className="mx-1 h-4 w-px bg-line" />
        <Button variant="ghost" size="icon" onClick={onClearLogs}>
          clear logs
        </Button>
        <Button
          variant="outline"
          size="icon"
          title="Save screenshots + logs + network as one HTML report"
          onClick={onExportReport}
        >
          ⤓ report
        </Button>
      </div>
    </header>
  );
}
