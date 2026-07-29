import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConsolePanel } from '../src/components/ConsolePanel';
import { MAX_LOGS } from '../src/constants';
import type { LogEntry, SessionMeta } from '../src/types';

/**
 * 패널의 계약은 "무엇이 보이는가"다. 순수 함수(filterLogs·isNearBottom)는 따로 검증하니
 * 여기서는 **배선**을 고정한다: 필터가 실제로 목록을 바꾸는가, 상한과 합친 횟수를
 * 화면에 밝히는가, 오토스크롤이 사용자 스크롤을 존중하는가.
 */

const session = (id: string, label: string): SessionMeta => ({
  id,
  label,
  userAgent: 'ua',
  startedAt: 0,
});

let nextId = 0;
const log = (partial: Partial<LogEntry> = {}): LogEntry => ({
  id: nextId++,
  sessionId: 's1',
  kind: 'console',
  level: 'log',
  text: 'hello',
  ts: 0,
  ...partial,
});

describe('ConsolePanel', () => {
  it('로그 텍스트와 레벨을 렌더한다', () => {
    const { container } = render(
      <ConsolePanel logs={[log({ level: 'error', text: 'boom' })]} sessions={[]} />,
    );
    expect(screen.getByText('boom')).toBeTruthy();
    // 'error'는 레벨 필터 버튼에도 있으므로 로그 줄 안에서 찾는다
    const line = container.querySelector('.log-line');
    expect(line?.querySelector('.log-kind')?.textContent).toBe('error');
    expect(line?.className).toContain('error');
  });

  it('pageerror의 스택을 상세로 함께 보여준다', () => {
    render(
      <ConsolePanel
        logs={[log({ kind: 'pageerror', level: 'error', text: 'oops', detail: 'at pay.js:1:1' })]}
        sessions={[]}
      />,
    );
    expect(screen.getByText('at pay.js:1:1')).toBeTruthy();
  });

  it('내비게이션은 구분선으로 렌더한다 — 로그가 어느 화면의 것인지 보여준다', () => {
    render(
      <ConsolePanel
        logs={[log({ kind: 'navigation', level: 'info', text: 'http://x/pay' })]}
        sessions={[]}
      />,
    );
    expect(screen.getByText('navigate')).toBeTruthy();
    expect(screen.getByText('→ http://x/pay')).toBeTruthy();
  });

  describe('반복 횟수', () => {
    it('합쳐진 로그는 ×N을 함께 보여준다 — 조용히 합치면 오도한다', () => {
      render(
        <ConsolePanel logs={[log({ text: 'Failed to fetch', repeat: 3_000 })]} sessions={[]} />,
      );
      expect(screen.getByText('×3000')).toBeTruthy();
    });

    it('1회면 배지를 붙이지 않는다', () => {
      render(<ConsolePanel logs={[log({ repeat: 1 }), log()]} sessions={[]} />);
      expect(screen.queryByText(/^×/)).toBeNull();
    });
  });

  describe('렌더 상한', () => {
    it('상한 이하면 알림 없이 전부 보여준다', () => {
      const logs = Array.from({ length: 10 }, (_, i) => log({ text: `line${i}` }));
      render(<ConsolePanel logs={logs} sessions={[]} />);
      expect(screen.queryByText(/older entries hidden/)).toBeNull();
      expect(screen.getByText('line0')).toBeTruthy();
    });

    it('상한을 넘으면 최신만 렌더하고 숨긴 건수를 밝힌다', () => {
      // 캡처 파일에는 상한이 없다 — 전부 그리면 브라우저가 멈춘다(실측)
      const logs = Array.from({ length: MAX_LOGS + 250 }, (_, i) => log({ text: `line${i}` }));
      render(<ConsolePanel logs={logs} sessions={[]} />);

      expect(screen.getByText(/250 older entries hidden/)).toBeTruthy();
      // 최신이 남는다 — 실패 직전 맥락이 뒤쪽에 있다
      expect(screen.getByText(`line${MAX_LOGS + 249}`)).toBeTruthy();
      expect(screen.queryByText('line0')).toBeNull();
    });

    it('검색으로 좁히면 숨어 있던 앞쪽 엔트리에 도달한다', () => {
      const logs = Array.from({ length: MAX_LOGS + 250 }, (_, i) => log({ text: `line${i}` }));
      render(<ConsolePanel logs={logs} sessions={[]} />);
      expect(screen.queryByText('line7')).toBeNull();

      fireEvent.change(screen.getByLabelText('search logs'), { target: { value: 'line7' } });
      expect(screen.getByText('line7')).toBeTruthy();
      expect(screen.queryByText(/older entries hidden/)).toBeNull();
    });
  });

  describe('필터 배선', () => {
    it('레벨 필터가 목록을 바꾼다 (warning은 error를 포함한다)', () => {
      const logs = [
        log({ level: 'log', text: 'plain' }),
        log({ level: 'warning', text: 'careful' }),
        log({ level: 'error', text: 'boom' }),
      ];
      render(<ConsolePanel logs={logs} sessions={[]} />);

      fireEvent.click(screen.getByRole('button', { name: 'error' }));
      expect(screen.getByText('boom')).toBeTruthy();
      expect(screen.queryByText('plain')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'warning' }));
      expect(screen.getByText('careful')).toBeTruthy();
      expect(screen.getByText('boom')).toBeTruthy();
      expect(screen.queryByText('plain')).toBeNull();
    });

    it('세션 버튼이 그 세션의 로그만 남긴다', () => {
      const logs = [
        log({ sessionId: 's1', text: 'from one' }),
        log({ sessionId: 's2', text: 'from two' }),
      ];
      render(
        <ConsolePanel logs={logs} sessions={[session('s1', '결제 웹뷰'), session('s2', '홈')]} />,
      );

      fireEvent.click(screen.getByRole('button', { name: '홈' }));
      expect(screen.getByText('from two')).toBeTruthy();
      expect(screen.queryByText('from one')).toBeNull();
    });
  });

  describe('오토스크롤', () => {
    it('바닥 근처를 벗어나면 따라가기를 멈추고 복귀 버튼을 준다', () => {
      const { container } = render(<ConsolePanel logs={[log()]} sessions={[]} />);
      const body = container.querySelector('.console-body') as HTMLElement;
      expect(screen.queryByTitle('Resume following new logs')).toBeNull();

      // 과거 로그를 보는 중에 새 로그가 화면을 끌어내리면 안 된다 (데브툴 표준 UX)
      Object.defineProperties(body, {
        scrollTop: { value: 0, writable: true },
        scrollHeight: { value: 1_000, configurable: true },
        clientHeight: { value: 200, configurable: true },
      });
      fireEvent.scroll(body);

      expect(screen.getByTitle('Resume following new logs')).toBeTruthy();
    });

    it('복귀 버튼을 누르면 바닥으로 내려가고 버튼이 사라진다', () => {
      const { container } = render(<ConsolePanel logs={[log()]} sessions={[]} />);
      const body = container.querySelector('.console-body') as HTMLElement;
      Object.defineProperties(body, {
        scrollTop: { value: 0, writable: true },
        scrollHeight: { value: 1_000, configurable: true },
        clientHeight: { value: 200, configurable: true },
      });
      fireEvent.scroll(body);

      fireEvent.click(screen.getByTitle('Resume following new logs'));
      expect(body.scrollTop).toBe(1_000);
      expect(screen.queryByTitle('Resume following new logs')).toBeNull();
    });
  });

  it('로그가 많아도 상한 이상 DOM을 만들지 않는다 (프리즈 회귀 방지)', () => {
    const logs = Array.from({ length: 20_000 }, (_, i) => log({ text: `line${i}` }));
    const started = performance.now();
    const { container } = render(<ConsolePanel logs={logs} sessions={[]} />);
    const elapsed = performance.now() - started;

    // 알림 1줄 + 상한만큼
    expect(container.querySelectorAll('.log-line')).toHaveLength(MAX_LOGS + 1);
    // 상한이 없으면 2만 줄을 그리며 초 단위로 걸린다
    expect(elapsed).toBeLessThan(2_000);
  });
});

describe('빈 상태', () => {
  it('로그가 없으면 목록이 비어 있다 (안내는 App이 담당한다)', () => {
    const { container } = render(<ConsolePanel logs={[]} sessions={[]} />);
    expect(container.querySelectorAll('.log-line')).toHaveLength(0);
  });
});
