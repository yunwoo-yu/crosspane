import type { EngineName, LogEntry, NetworkEntry } from './types';

/**
 * 버그 리포트 내보내기 — 현재 대시보드 상태(스크린샷/로그/네트워크)를
 * 단일 자급자족 HTML로 만든다. 이슈/슬랙에 파일 하나로 첨부 가능하고
 * 어디서든 열린다 (외부 의존성/네트워크 요청 없음).
 */

export interface ReportEngineSnapshot {
  engine: EngineName;
  currentUrl?: string;
  status?: string;
  /** canvas.toDataURL 결과 — 프레임이 없으면 undefined */
  screenshotDataUrl?: string;
}

export interface ReportInput {
  targetUrl: string;
  device: string;
  generatedAt: Date;
  engines: ReportEngineSnapshot[];
  logs: LogEntry[];
  networkEntries: NetworkEntry[];
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatTime(ts: number): string {
  return new Date(ts).toTimeString().slice(0, 8);
}

const LEVEL_COLOR: Record<string, string> = {
  error: '#e5484d',
  warning: '#f5a524',
  info: '#8b8d98',
};

function renderLogRow(log: LogEntry): string {
  const color = LEVEL_COLOR[log.level] ?? '#e2e2e5';
  return `<tr><td class="mono muted">${formatTime(log.ts)}</td><td class="mono">${escapeHtml(log.engine)}</td><td class="mono" style="color:${color}">${escapeHtml(log.level)}</td><td class="mono">${escapeHtml(log.text)}</td></tr>`;
}

function renderNetworkRow(entry: NetworkEntry): string {
  const statusColor = entry.status >= 400 ? '#e5484d' : '#8b8d98';
  return `<tr><td class="mono">${escapeHtml(entry.engine)}</td><td class="mono">${escapeHtml(entry.method)}</td><td class="mono" style="color:${statusColor}">${entry.status}</td><td class="mono">${escapeHtml(entry.url)}</td><td class="mono muted">${entry.durationMs >= 0 ? `${entry.durationMs}ms` : ''}</td></tr>`;
}

export function buildReportHtml(input: ReportInput): string {
  const engineCards = input.engines
    .map(
      (snapshot) => `
      <div class="engine">
        <h3>${escapeHtml(snapshot.engine)} <span class="muted">${escapeHtml(snapshot.status ?? '')}</span></h3>
        <div class="mono muted">${escapeHtml(snapshot.currentUrl ?? '-')}</div>
        ${
          snapshot.screenshotDataUrl
            ? `<img src="${snapshot.screenshotDataUrl}" alt="${escapeHtml(snapshot.engine)} screenshot" />`
            : '<div class="muted">no frame</div>'
        }
      </div>`,
    )
    .join('\n');

  // 에러/경고를 위로 — 리포트를 여는 사람이 가장 먼저 봐야 할 것
  const errors = input.logs.filter((log) => log.level === 'error');
  const restLogs = input.logs.filter((log) => log.level !== 'error');
  const failedRequests = input.networkEntries.filter((entry) => entry.status >= 400);

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<title>crosspane report — ${escapeHtml(input.targetUrl)}</title>
<style>
  body { background: #101014; color: #e2e2e5; font-family: -apple-system, 'Segoe UI', sans-serif; margin: 24px; }
  h1 { font-size: 18px; } h2 { font-size: 14px; margin-top: 28px; border-bottom: 1px solid #2a2a33; padding-bottom: 6px; }
  h3 { font-size: 12px; margin: 0 0 4px; }
  .mono { font-family: ui-monospace, Menlo, monospace; font-size: 11px; }
  .muted { color: #8b8d98; }
  .meta { display: flex; gap: 16px; flex-wrap: wrap; }
  .engines { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 12px; }
  .engine { flex: 1 1 220px; max-width: 320px; background: #17171c; border: 1px solid #2a2a33; border-radius: 8px; padding: 10px; }
  .engine img { width: 100%; margin-top: 8px; border-radius: 4px; }
  table { border-collapse: collapse; width: 100%; margin-top: 8px; }
  td, th { text-align: left; padding: 3px 10px 3px 0; vertical-align: top; border-bottom: 1px solid #1f1f26; }
  .badge { color: #e5484d; font-weight: 600; }
</style>
</head>
<body>
<h1>crosspane bug report</h1>
<div class="meta mono muted">
  <span>target: ${escapeHtml(input.targetUrl)}</span>
  <span>device: ${escapeHtml(input.device)}</span>
  <span>${input.generatedAt.toISOString()}</span>
</div>

<h2>Engines</h2>
<div class="engines">${engineCards}</div>

<h2>Errors <span class="badge">${errors.length}</span></h2>
<table>${errors.map(renderLogRow).join('\n')}</table>

<h2>Failed requests (4xx/5xx) <span class="badge">${failedRequests.length}</span></h2>
<table>${failedRequests.map(renderNetworkRow).join('\n')}</table>

<h2>Console (${restLogs.length})</h2>
<table>${restLogs.map(renderLogRow).join('\n')}</table>

<h2>Network (${input.networkEntries.length})</h2>
<table>${input.networkEntries.map(renderNetworkRow).join('\n')}</table>
</body>
</html>`;
}

/** 브라우저에서 리포트를 파일로 다운로드한다 */
export function downloadReport(html: string, targetUrl: string): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const host = targetUrl.replace(/^https?:\/\//, '').replace(/[^\w.-]/g, '_');
  const blob = new Blob([html], { type: 'text/html' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `crosspane-report-${host}-${stamp}.html`;
  link.click();
  URL.revokeObjectURL(link.href);
}
