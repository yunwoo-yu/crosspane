import { useEffect, useMemo, useRef, useState } from 'react';
import { MAX_LOGS } from '../constants';
import { useLocale } from '../hooks/useLocale';
import { formatLogTime, isNearBottom } from '../log-utils';
import {
  buildTimeline,
  countByKind,
  searchTimeline,
  type TimelineItem,
  type TimelineKind,
} from '../timeline';
import type { LogEntry, NetworkEntry } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';

interface TimelinePanelProps {
  logs: LogEntry[];
  network: NetworkEntry[];
}

/** 표시 순서 — 사람이 찾는 빈도 순이다 (에러가 먼저, 이동이 마지막) */
const KINDS: TimelineKind[] = ['error', 'console', 'network', 'interaction', 'vital', 'navigation'];

const KIND_CLASS: Record<TimelineKind, string> = {
  error: 'text-danger',
  console: 'text-fg',
  network: 'text-sky-400',
  interaction: 'text-violet-400',
  vital: 'text-amber-400',
  navigation: 'text-emerald-400',
};

/** 왼쪽 홈통의 종류 표시 — 색만으로 구분하면 색각 이상에서 읽히지 않는다 */
const KIND_MARK: Record<TimelineKind, string> = {
  error: '✕',
  console: '·',
  network: '⇅',
  interaction: '☞',
  vital: '◷',
  navigation: '→',
};

/**
 * 무슨 일이 있었나 — 로그·요청·상호작용·성능을 한 줄기로.
 *
 * 이 화면의 목적은 **인과**다. 깊이 파는 일(응답 본문, 헤더)은 콘솔·네트워크 탭이
 * 계속 맡는다. 여기서 그것까지 하려 들면 두 화면이 같은 것을 다르게 보여주게 된다.
 */
export function TimelinePanel({ logs, network }: TimelinePanelProps) {
  const { t } = useLocale();
  const [hidden, setHidden] = useState<Set<TimelineKind>>(() => new Set());
  const [search, setSearch] = useState('');
  const [follow, setFollow] = useState(true);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const counts = useMemo(() => countByKind(logs, network), [logs, network]);
  const shown = useMemo(() => new Set(KINDS.filter((kind) => !hidden.has(kind))), [hidden]);
  const matching = useMemo(
    () => searchTimeline(buildTimeline(logs, network, shown), search),
    [logs, network, shown, search],
  );
  // 렌더 상한 — 근거는 ConsolePanel의 같은 주석 (`.claude/rules/dashboard-render-window.md`)
  const visible = useMemo(
    () => (matching.length > MAX_LOGS ? matching.slice(-MAX_LOGS) : matching),
    [matching],
  );
  const hiddenCount = matching.length - visible.length;
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const filteredOut = total - matching.length;

  // biome-ignore lint/correctness/useExhaustiveDependencies(visible): 새 항목이 렌더된 뒤 바닥으로
  useEffect(() => {
    const body = bodyRef.current;
    if (follow && body) body.scrollTop = body.scrollHeight;
  }, [visible, follow]);

  const toggle = (kind: TimelineKind) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="console-head">
        <div className="filters">
          {KINDS.map((kind) => (
            <Button
              key={kind}
              variant={hidden.has(kind) ? 'ghost' : 'active'}
              size="icon"
              onClick={() => toggle(kind)}
              title={t.timelineKindTitle(t.timelineKind(kind))}
            >
              <span className={hidden.has(kind) ? 'opacity-50' : KIND_CLASS[kind]}>
                {KIND_MARK[kind]}
              </span>
              {t.timelineKind(kind)}
              {/* 건수를 칩에 달아 "여기 뭐가 있는지"를 켜 보기 전에 알린다 */}
              <span className="tabular-nums opacity-60">{counts[kind]}</span>
            </Button>
          ))}
        </div>
        <Input
          className="min-w-0 flex-1 sm:max-w-64"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t.filterTimeline}
          aria-label={t.filterTimeline}
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
          <div className="log-line nav">
            <span className="log-text">{t.olderHidden(hiddenCount.toLocaleString())}</span>
          </div>
        )}
        {visible.length === 0 && (
          <div className="flex flex-col items-start gap-2 py-6 text-fg-muted">
            <span>{total === 0 ? t.timelineEmpty : t.noMatches}</span>
            {/* 꺼 둔 종류가 있으면 빈 화면의 이유가 그것일 수 있다 — 되돌릴 길을 준다 */}
            {filteredOut > 0 && (
              <Button
                variant="warn"
                size="icon"
                onClick={() => {
                  setHidden(new Set());
                  setSearch('');
                }}
              >
                {t.hiddenByFilter(filteredOut)} · {t.showEverything}
              </Button>
            )}
          </div>
        )}
        {visible.map((item) => (
          <TimelineRow key={item.key} item={item} />
        ))}
      </div>
    </div>
  );
}

function TimelineRow({ item }: { item: TimelineItem }) {
  return (
    <div className={`log-line ${item.bad ? 'error' : ''}`}>
      <span className="log-time">{formatLogTime(item.ts)}</span>
      <span className={`w-4 shrink-0 text-center ${KIND_CLASS[item.kind]}`} aria-hidden>
        {KIND_MARK[item.kind]}
      </span>
      {item.label && <span className="log-kind">{item.label}</span>}
      {item.repeat !== undefined && item.repeat > 1 && (
        <span className="shrink-0 rounded bg-panel px-1 font-semibold text-fg-muted text-xs tabular-nums">
          ×{item.repeat}
        </span>
      )}
      <span className="log-text">{item.text}</span>
      {item.detail && <pre className="log-detail">{item.detail}</pre>}
    </div>
  );
}
