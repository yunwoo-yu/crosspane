import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ConsolePanel } from '../src/components/ConsolePanel';
import { EnginePane } from '../src/components/EnginePane';
import { Toolbar } from '../src/components/Toolbar';
import type { EngineName, FrameListener, HelloEvent, LogEntry } from '../src/types';

const helloEvent: HelloEvent = {
  type: 'hello',
  url: 'http://localhost:3000',
  device: 'iPhone 15',
  engines: ['chromium', 'webkit'],
  viewport: { width: 390, height: 844 },
};

const fakeFrame = { width: 390, height: 844, close: vi.fn() } as unknown as ImageBitmap;

/** EnginePane을 렌더하고 프레임 리스너를 캡처해 프레임 주입을 흉내낼 수 있게 한다 */
function renderEnginePane(overrides: {
  onSendCommand?: ReturnType<typeof vi.fn>;
  status?: 'starting' | 'ready' | 'error' | 'stopped';
  detail?: string;
  errorCount?: number;
  currentUrl?: string;
  urlDesynced?: boolean;
  viewOnly?: boolean;
  focused?: boolean;
  onToggleFocus?: ReturnType<typeof vi.fn>;
}) {
  let capturedListener: FrameListener | undefined;
  const subscribeToFrames = (_engine: EngineName, listener: FrameListener) => {
    capturedListener = listener;
    return () => {};
  };
  const view = render(
    <EnginePane
      engine="chromium"
      state={{
        status: overrides.status ?? 'ready',
        detail: overrides.detail,
        currentUrl: overrides.currentUrl,
      }}
      errorCount={overrides.errorCount ?? 0}
      urlDesynced={overrides.urlDesynced ?? false}
      viewOnly={overrides.viewOnly ?? false}
      focused={overrides.focused ?? false}
      visible={true}
      onToggleFocus={overrides.onToggleFocus ?? vi.fn()}
      onSendCommand={overrides.onSendCommand ?? vi.fn()}
      subscribeToFrames={subscribeToFrames}
    />,
  );
  return {
    view,
    emitFrame: (scrollY = 0) => {
      if (!capturedListener) throw new Error('frame listener not captured');
      act(() => capturedListener?.(fakeFrame, scrollY));
    },
  };
}

describe('Toolbar', () => {
  it('연결 상태·타깃 URL을 보여주고 back/forward/reload/clear 버튼이 동작한다', () => {
    const onSendCommand = vi.fn();
    const onClearLogs = vi.fn();
    render(
      <Toolbar
        connected={true}
        hello={helloEvent}
        urlDesynced={false}
        syncTargetUrl={undefined}
        onSendCommand={onSendCommand}
        onClearLogs={onClearLogs}
      />,
    );

    expect(screen.getByText('connected')).toBeTruthy();
    // URL 바가 타깃 주소로 초기화된다
    expect(screen.getByLabelText('navigate all engines')).toHaveProperty(
      'value',
      'http://localhost:3000',
    );
    expect(screen.queryByText(/재동기화/)).toBeNull(); // 정상 상태에선 숨김

    fireEvent.click(screen.getByTitle('뒤로가기'));
    expect(onSendCommand).toHaveBeenCalledWith({ type: 'back' });

    fireEvent.click(screen.getByTitle('앞으로가기'));
    expect(onSendCommand).toHaveBeenCalledWith({ type: 'forward' });

    fireEvent.click(screen.getByText('⟳ reload all'));
    expect(onSendCommand).toHaveBeenCalledWith({ type: 'reload' });

    fireEvent.click(screen.getByText('clear logs'));
    expect(onClearLogs).toHaveBeenCalled();
  });

  it('URL 바 입력을 정규화해 navigate로 보낸다', () => {
    const onSendCommand = vi.fn();
    render(
      <Toolbar
        connected={true}
        hello={helloEvent}
        urlDesynced={false}
        syncTargetUrl={undefined}
        onSendCommand={onSendCommand}
        onClearLogs={vi.fn()}
      />,
    );
    const input = screen.getByLabelText('navigate all engines');
    fireEvent.change(input, { target: { value: ':5173' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(onSendCommand).toHaveBeenCalledWith({
      type: 'navigate',
      url: 'http://localhost:5173',
    });
  });

  it('URL이 어긋나면 재동기화 버튼이 나타나고 기준 URL로 navigate를 보낸다', () => {
    const onSendCommand = vi.fn();
    render(
      <Toolbar
        connected={true}
        hello={helloEvent}
        urlDesynced={true}
        syncTargetUrl="http://localhost:3000/?date=2026-08-03"
        onSendCommand={onSendCommand}
        onClearLogs={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText(/재동기화/));
    expect(onSendCommand).toHaveBeenCalledWith({
      type: 'navigate',
      url: 'http://localhost:3000/?date=2026-08-03',
    });
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

    const onSendCommand = vi.fn();
    const { emitFrame } = renderEnginePane({ onSendCommand });
    emitFrame(); // 프레임이 있어야 canvas가 표시된다

    fireEvent.pointerDown(screen.getByLabelText('chromium'), { clientX: 50, clientY: 50 });
    expect(onSendCommand).toHaveBeenCalledWith({ type: 'click', x: 0.5, y: 0.25 });
  });

  it('휠 델타를 모아 하나의 scroll 커맨드로 보내고, 로컬 에코로 즉시 이동시킨다', () => {
    vi.useFakeTimers();
    const onSendCommand = vi.fn();
    const { view, emitFrame } = renderEnginePane({ onSendCommand });
    emitFrame(); // canvas 크기(프레임 크기) 확보
    const paneScreen = view.container.querySelector('.pane-screen');
    const canvas = view.container.querySelector('canvas');
    if (!paneScreen || !canvas) throw new Error('pane elements not found');

    fireEvent.wheel(paneScreen, { deltaY: 30 });
    fireEvent.wheel(paneScreen, { deltaY: 40 });
    expect(onSendCommand).not.toHaveBeenCalled(); // 플러시 전에는 전송하지 않는다
    // 서버 응답을 기다리지 않고 canvas가 즉시 이동한다 (로컬 에코)
    expect(canvas.style.transform).toContain('translateY');

    vi.advanceTimersByTime(200);
    expect(onSendCommand).toHaveBeenCalledTimes(1);
    expect(onSendCommand).toHaveBeenCalledWith({ type: 'scroll', deltaY: 70 });

    // 아직 목표(70)에 못 미친 프레임(scrollY=30) — 남은 40만큼 에코 유지 (고무줄 방지)
    emitFrame(30);
    expect(canvas.style.transform).toContain('translateY');
    // 목표를 따라잡은 프레임 — 에코 해제, 실제 화면으로 스냅
    emitFrame(70);
    expect(canvas.style.transform).toBe('');
    vi.useRealTimers();
  });

  it('view-only pane은 입력을 전혀 보내지 않는다', () => {
    const onSendCommand = vi.fn();
    const { view, emitFrame } = renderEnginePane({ onSendCommand, viewOnly: true });
    emitFrame();
    const paneScreen = view.container.querySelector('.pane-screen');
    const canvas = view.container.querySelector('canvas');
    if (!paneScreen || !canvas) throw new Error('pane elements not found');

    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.keyDown(paneScreen, { key: 'a' });
    fireEvent.wheel(paneScreen, { deltaY: 30 });
    expect(onSendCommand).not.toHaveBeenCalled();
    expect(screen.getByText('view-only')).toBeTruthy();
  });

  it('키 입력을 엔진으로 포워딩한다 (문자는 type, 특수키는 keypress)', () => {
    const onSendCommand = vi.fn();
    const { view } = renderEnginePane({ onSendCommand });
    const paneScreen = view.container.querySelector('.pane-screen');
    if (!paneScreen) throw new Error('pane-screen not found');

    fireEvent.keyDown(paneScreen, { key: 'a' });
    expect(onSendCommand).toHaveBeenCalledWith({ type: 'type', text: 'a' });

    fireEvent.keyDown(paneScreen, { key: 'Enter' });
    expect(onSendCommand).toHaveBeenCalledWith({ type: 'keypress', key: 'Enter' });

    onSendCommand.mockClear();
    fireEvent.keyDown(paneScreen, { key: 'r', metaKey: true }); // OS 단축키는 무시
    fireEvent.keyDown(paneScreen, { key: 'Shift' }); // 단독 수정키도 무시
    expect(onSendCommand).not.toHaveBeenCalled();
  });

  it('현재 URL을 path로 표시하고 desync면 경고 스타일을 붙인다', () => {
    renderEnginePane({
      currentUrl: 'http://localhost:3000/reservations/1?tab=info',
      urlDesynced: true,
    });
    const url = screen.getByText('/reservations/1?tab=info');
    expect(url.className).toContain('desynced');
    expect(url.getAttribute('title')).toBe('http://localhost:3000/reservations/1?tab=info');
  });

  it('첫 프레임 전에는 placeholder, 에러면 실패 사유를 보여준다', () => {
    renderEnginePane({ status: 'starting' });
    expect(screen.getByText('starting…')).toBeTruthy();
  });

  it('에러 상태면 실패 사유를 보여준다', () => {
    renderEnginePane({ status: 'error', detail: 'launch failed' });
    expect(screen.getByText(/failed: launch failed/)).toBeTruthy();
  });

  it('에러 개수가 있으면 배지를 표시한다', () => {
    renderEnginePane({ errorCount: 3 });
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('stopped pane은 Start 버튼을 보여주고 start-engine을 보낸다', () => {
    const onSendCommand = vi.fn();
    renderEnginePane({ status: 'stopped', onSendCommand });
    fireEvent.click(screen.getByText(/Start chromium/));
    expect(onSendCommand).toHaveBeenCalledWith({ type: 'start-engine', engine: 'chromium' });
  });

  it('실행 중 pane의 ■ 버튼은 stop-engine을 보낸다', () => {
    const onSendCommand = vi.fn();
    renderEnginePane({ status: 'ready', onSendCommand });
    fireEvent.click(screen.getByTitle('이 엔진 중지 (리소스 반환)'));
    expect(onSendCommand).toHaveBeenCalledWith({ type: 'stop-engine', engine: 'chromium' });
  });

  it('포커스 토글 버튼이 onToggleFocus를 호출한다', () => {
    const onToggleFocus = vi.fn();
    renderEnginePane({ onToggleFocus });
    fireEvent.click(screen.getByTitle('이 pane만 크게'));
    expect(onToggleFocus).toHaveBeenCalled();
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

    fireEvent.click(screen.getAllByRole('button', { name: 'all' })[0]); // 엔진 필터의 all
    expect(screen.getByText('chromium-only-log')).toBeTruthy();
  });

  it('error 레벨 로그에 error 클래스를 붙인다', () => {
    render(<ConsolePanel logs={logs} engines={['chromium', 'webkit']} />);
    const errorLine = screen.getByText('webkit-only-error').closest('.log-line');
    expect(errorLine?.className).toContain('error');
  });
});
