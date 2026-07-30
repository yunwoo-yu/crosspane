import { useEffect, useMemo, useRef, useState } from 'react';
import { MAX_LOGS } from '../constants';
import { useLocale } from '../hooks/useLocale';
import type { Messages } from '../i18n';
import {
  type ConsoleLevelFilter,
  filterLogs,
  formatLogTime,
  formatRepeatSpan,
  isNearBottom,
} from '../log-utils';
import type { LogEntry } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';

interface ConsolePanelProps {
  logs: LogEntry[];
}

const LEVELS: ConsoleLevelFilter[] = ['all', 'log', 'warning', 'error'];

/** 레벨 필터 라벨 — 값(`ConsoleLevelFilter`)은 로직용이라 번역하지 않는다 */
function LEVEL_LABEL(t: Messages, level: ConsoleLevelFilter): string {
  if (level === 'log') return t.levelLog;
  if (level === 'warning') return t.levelWarning;
  if (level === 'error') return t.levelError;
  return t.levelAll;
}

function RepeatBadge({ repeat, span }: { repeat: number; span: string | null }) {
  const { t } = useLocale();
  return (
    <span
      className="shrink-0 rounded bg-panel px-1 font-semibold text-fg-muted text-xs tabular-nums"
      title={t.repeatTitle(repeat, span)}
    >
      ×{repeat}
      {span && <span className="ml-1 font-normal opacity-70">{span}</span>}
    </span>
  );
}

function levelClass(level: string): string {
  if (level === 'error') return 'error';
  if (level === 'warning') return 'warn';
  return '';
}

export function ConsolePanel({ logs }: ConsolePanelProps) {
  const { t } = useLocale();
  const [levelFilter, setLevelFilter] = useState<ConsoleLevelFilter>('all');
  const [search, setSearch] = useState('');
  // 스마트 오토스크롤: 바닥 근처에 있을 때만 새 로그를 따라간다
  const [follow, setFollow] = useState(true);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const matching = useMemo(
    () => filterLogs(logs, { sessionId: 'all', level: levelFilter, search }),
    [logs, levelFilter, search],
  );
  /**
   * 렌더는 라이브 상한만큼만 한다. 캡처 파일에는 상한이 없어서(다른 사람이 보낸 파일
   * 전체를 봐야 한다) 10만 줄을 그대로 그리면 DOM 40만 노드·heap 170MB·669ms 멈춤이
   * 된다(실측). 데이터는 전부 들고 있으므로 필터·검색으로 어디든 도달할 수 있다.
   */
  // **반드시 memo할 것**: slice가 매 렌더 새 배열을 만들면 아래 오토스크롤 effect가
  // 리렌더마다 발동해 사용자가 스크롤을 올려 둔 것을 계속 바닥으로 끌어내린다(실측:
  // 같은 props 3회 리렌더에 스크롤 강제 3회)
  const visible = useMemo(
    () => (matching.length > MAX_LOGS ? matching.slice(-MAX_LOGS) : matching),
    [matching],
  );
  const hiddenCount = matching.length - visible.length;

  // biome-ignore lint/correctness/useExhaustiveDependencies(visible): 새 로그가 렌더된 뒤 바닥으로 스크롤해야 하므로 visible 변경이 트리거
  useEffect(() => {
    const body = bodyRef.current;
    if (follow && body) body.scrollTop = body.scrollHeight;
  }, [visible, follow]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="console-head">
        <div className="filters">
          {LEVELS.map((level) => (
            <Button
              key={level}
              variant={levelFilter === level ? 'active' : 'ghost'}
              size="icon"
              onClick={() => setLevelFilter(level)}
              title={level === 'warning' ? t.warningAndAbove : LEVEL_LABEL(t, level)}
            >
              {LEVEL_LABEL(t, level)}
            </Button>
          ))}
        </div>
        <Input
          /* 남은 폭을 먹되 줄어들 수 있어야 한다 — min-w-0이 없으면 좁은 화면에서
             입력이 줄어들지 않아 필터 바 전체가 가로로 넘친다 (실측: 390px에서 잘림) */
          className="min-w-0 flex-1 sm:max-w-64"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t.filterLogs}
          aria-label={t.searchLogs}
        />
        {!follow && (
          <Button
            variant="warn"
            size="icon"
            onClick={() => {
              setFollow(true);
              const body = bodyRef.current;
              if (body) body.scrollTop = body.scrollHeight;
            }}
            title={t.resumeFollowing}
          >
            {t.jumpToLatest}
          </Button>
        )}
      </div>
      <div
        className="console-body"
        ref={bodyRef}
        onScroll={(event) => setFollow(isNearBottom(event.currentTarget))}
      >
        {hiddenCount > 0 && (
          // 조용히 자르면 "이게 전부"로 오도한다 — 몇 건을 숨겼는지 밝힌다
          <div className="log-line nav">
            <span className="log-text">{t.olderHidden(hiddenCount.toLocaleString())}</span>
          </div>
        )}
        {visible.map((log) =>
          log.kind === 'navigation' ? (
            // 페이지 이동/리로드 구분선 — 이후 로그가 어느 화면의 것인지 보여준다
            <div key={log.id} className="log-line nav">
              <span className="log-time">{formatLogTime(log.ts)}</span>
              <span className="log-kind">{t.kindNavigate}</span>
              <span className="log-text">→ {log.text}</span>
            </div>
          ) : (
            <div key={log.id} className={`log-line ${levelClass(log.level)}`}>
              <span className="log-time">{formatLogTime(log.ts)}</span>
              <span className="log-kind">{log.kind === 'console' ? log.level : log.kind}</span>
              {/*
                반복 횟수와 이어진 기간 — 합쳤다는 사실을 밝힌다.
                기간이 없으면 10분간 계속된 에러가 "처음에 몇 번 나고 멈췄다"로 읽힌다
              */}
              {log.repeat !== undefined && log.repeat > 1 && (
                <RepeatBadge repeat={log.repeat} span={formatRepeatSpan(log.ts, log.repeatUntil)} />
              )}
              <span className="log-text">{log.text}</span>
              {log.detail && <pre className="log-detail">{log.detail}</pre>}
            </div>
          ),
        )}
      </div>
    </div>
  );
}
