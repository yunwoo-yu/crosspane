import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ConsolePanel } from '../src/components/ConsolePanel';
import { EnginePane } from '../src/components/EnginePane';
import { Toolbar } from '../src/components/Toolbar';
import type { HelloMessage, LogEntry } from '../src/types';

const hello: HelloMessage = {
  type: 'hello',
  url: 'http://localhost:3000',
  device: 'iPhone 15',
  engines: ['chromium', 'webkit'],
  viewport: { width: 390, height: 844 },
};

describe('Toolbar', () => {
  it('연결 상태·타깃 URL을 보여주고 reload/clear 버튼이 동작한다', () => {
    const onSend = vi.fn();
    const onClearLogs = vi.fn();
    render(<Toolbar connected={true} hello={hello} onSend={onSend} onClearLogs={onClearLogs} />);

    expect(screen.getByText('connected')).toBeTruthy();
    expect(screen.getByText('http://localhost:3000')).toBeTruthy();

    fireEvent.click(screen.getByText('⟳ reload all'));
    expect(onSend).toHaveBeenCalledWith({ type: 'reload' });

    fireEvent.click(screen.getByText('clear logs'));
    expect(onClearLogs).toHaveBeenCalled();
  });
});

describe('EnginePane', () => {
  beforeAll(() => {
    // jsdom에는 PointerEvent가 없어 clientX/Y가 유실된다 — MouseEvent로 대체
    if (!window.PointerEvent) {
      window.PointerEvent = window.MouseEvent as unknown as typeof PointerEvent;
    }
  });

  it('클릭 좌표를 0~1로 정규화해서 보낸다', () => {
    // jsdom은 레이아웃이 없으므로 표시 크기를 100x200으로 고정한다
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 200,
      width: 100,
      height: 200,
      toJSON: () => ({}),
    } as DOMRect);

    const onSend = vi.fn();
    render(
      <EnginePane
        engine="chromium"
        state={{ status: 'ready', frame: 'abc' }}
        errorCount={0}
        onSend={onSend}
      />,
    );

    fireEvent.pointerDown(screen.getByAltText('chromium'), { clientX: 50, clientY: 50 });
    expect(onSend).toHaveBeenCalledWith({ type: 'click', x: 0.5, y: 0.25 });
  });

  it('프레임이 없으면 placeholder, 에러면 실패 사유를 보여준다', () => {
    const onSend = vi.fn();
    const { rerender } = render(
      <EnginePane engine="webkit" state={{ status: 'starting' }} errorCount={0} onSend={onSend} />,
    );
    expect(screen.getByText('starting…')).toBeTruthy();

    rerender(
      <EnginePane
        engine="webkit"
        state={{ status: 'error', detail: 'launch failed' }}
        errorCount={0}
        onSend={onSend}
      />,
    );
    expect(screen.getByText(/failed: launch failed/)).toBeTruthy();
  });

  it('에러 개수가 있으면 배지를 표시한다', () => {
    render(
      <EnginePane
        engine="firefox"
        state={{ status: 'ready', frame: 'abc' }}
        errorCount={3}
        onSend={vi.fn()}
      />,
    );
    expect(screen.getByText('3')).toBeTruthy();
  });
});

describe('ConsolePanel', () => {
  beforeAll(() => {
    // jsdom에는 scrollIntoView가 없다
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  const logs: LogEntry[] = [
    { id: 1, engine: 'chromium', kind: 'console', level: 'log', text: 'chromium-only-log', ts: 1 },
    {
      id: 2,
      engine: 'webkit',
      kind: 'pageerror',
      level: 'error',
      text: 'webkit-only-error',
      ts: 2,
    },
  ];

  it('엔진 필터로 로그를 걸러낸다', () => {
    render(<ConsolePanel logs={logs} engines={['chromium', 'webkit']} />);

    expect(screen.getByText('chromium-only-log')).toBeTruthy();
    expect(screen.getByText('webkit-only-error')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'webkit' }));
    expect(screen.queryByText('chromium-only-log')).toBeNull();
    expect(screen.getByText('webkit-only-error')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'all' }));
    expect(screen.getByText('chromium-only-log')).toBeTruthy();
  });

  it('error 레벨 로그에 error 클래스를 붙인다', () => {
    render(<ConsolePanel logs={logs} engines={['chromium', 'webkit']} />);
    const errorLine = screen.getByText('webkit-only-error').closest('.log-line');
    expect(errorLine?.className).toContain('error');
  });
});
