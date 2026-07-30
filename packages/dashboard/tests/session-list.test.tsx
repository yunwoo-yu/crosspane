import { describe, expect, it, vi } from 'vitest';
import { SessionList } from '../src/components/SessionList';
import type { SessionMeta, SessionState } from '../src/types';
import { fireEvent, render, screen } from './render';

/**
 * 여러 기기를 동시에 붙이는 것이 이 툴의 전제다 — 목록은 어느 것이 살아 있고
 * 어디에 에러가 났는지 한눈에 보여야 한다.
 */

const session = (partial: Partial<SessionMeta> = {}): SessionMeta => ({
  id: 's1',
  label: '결제 웹뷰',
  userAgent: 'Mozilla/5.0 (Linux; Android 14; wv)',
  platform: 'android-webview',
  startedAt: 0,
  ...partial,
});

const state = (partial: Partial<SessionState> = {}): SessionState => ({
  live: true,
  errorCount: 0,
  ...partial,
});

describe('SessionList', () => {
  it('세션이 없으면 아무것도 렌더하지 않는다 (안내는 App이 담당한다)', () => {
    const { container } = render(
      <SessionList sessions={[]} states={{}} selectedId={null} onSelect={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('라벨과 플랫폼 표시명을 보여준다', () => {
    render(
      <SessionList
        sessions={[session()]}
        states={{ s1: state() }}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText('결제 웹뷰')).toBeTruthy();
    // 원시 platform 문자열이 아니라 사람이 읽는 라벨이어야 한다
    expect(screen.getByText('Android WebView')).toBeTruthy();
  });

  it('모르는 platform은 원본 문자열을 그대로 쓴다', () => {
    render(
      <SessionList
        sessions={[session({ platform: 'smart-fridge' })]}
        states={{ s1: state() }}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText('smart-fridge')).toBeTruthy();
  });

  it('라이브/종료를 접근성 라벨로 구분한다', () => {
    const { rerender } = render(
      <SessionList
        sessions={[session()]}
        states={{ s1: state({ live: true }) }}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('live')).toBeTruthy();

    rerender(
      <SessionList
        sessions={[session()]}
        states={{ s1: state({ live: false }) }}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('ended')).toBeTruthy();
  });

  it('에러 수를 배지로 보여주고, 0이면 붙이지 않는다', () => {
    const { rerender } = render(
      <SessionList
        sessions={[session()]}
        states={{ s1: state({ errorCount: 3 }) }}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText('3')).toBeTruthy();

    rerender(
      <SessionList
        sessions={[session()]}
        states={{ s1: state({ errorCount: 0 }) }}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.queryByText('0')).toBeNull();
  });

  it('현재 URL은 path만 보여준다 (긴 도메인이 목록을 밀지 않게)', () => {
    render(
      <SessionList
        sessions={[session()]}
        states={{ s1: state({ currentUrl: 'https://shop.example.com/checkout/confirm?step=2' }) }}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText('/checkout/confirm?step=2')).toBeTruthy();
  });

  it('상태가 아직 없는 세션도 렌더한다 (register 직후)', () => {
    expect(() =>
      render(
        <SessionList sessions={[session()]} states={{}} selectedId={null} onSelect={vi.fn()} />,
      ),
    ).not.toThrow();
    expect(screen.getByLabelText('ended')).toBeTruthy();
  });

  describe('선택', () => {
    it('세션을 누르면 그 id를 알린다', () => {
      const onSelect = vi.fn();
      render(
        <SessionList
          sessions={[session()]}
          states={{ s1: state() }}
          selectedId={null}
          onSelect={onSelect}
        />,
      );
      fireEvent.click(screen.getByText('결제 웹뷰'));
      expect(onSelect).toHaveBeenCalledWith('s1');
    });

    it('All sessions는 null을 알린다 (선택 해제)', () => {
      const onSelect = vi.fn();
      render(
        <SessionList
          sessions={[session()]}
          states={{ s1: state() }}
          selectedId="s1"
          onSelect={onSelect}
        />,
      );
      fireEvent.click(screen.getByText('All sessions'));
      expect(onSelect).toHaveBeenCalledWith(null);
    });

    it('userAgent를 title로 노출한다 — 어느 기기인지 확인하는 유일한 단서다', () => {
      render(
        <SessionList
          sessions={[session()]}
          states={{ s1: state() }}
          selectedId={null}
          onSelect={vi.fn()}
        />,
      );
      expect(screen.getByTitle('Mozilla/5.0 (Linux; Android 14; wv)')).toBeTruthy();
    });
  });
});
