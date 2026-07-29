import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScreenPanel } from '../src/components/ScreenPanel';

/**
 * 플레이어 자체는 jsdom에서 동작하지 않는다 (동적 import + 실제 렌더링).
 * 여기서는 플레이어를 띄우기 **전** 분기 — 안내 문구와 대기 상태 — 를 고정한다.
 * 실제 재생은 examples/demo + agent-browser로 검증한다.
 */
describe('ScreenPanel', () => {
  it('기록이 없으면 플러그인 설치 안내를 보여준다', () => {
    render(<ScreenPanel events={[]} />);
    expect(screen.getByText(/No screen recording/)).toBeTruthy();
    expect(screen.getByText(/@crosspane\/agent-replay/)).toBeTruthy();
  });

  it('이벤트가 1개면 전체 스냅샷 대기 상태를 알린다', () => {
    // rrweb은 [Meta, FullSnapshot, …] 구조라 1개로는 재생을 시작할 수 없다
    render(<ScreenPanel events={[{ type: 4 }]} />);
    expect(screen.getByText(/Waiting for the first full snapshot/)).toBeTruthy();
  });

  it('이벤트가 충분하면 대기 문구 없이 플레이어 컨테이너를 렌더한다', () => {
    const { container } = render(<ScreenPanel events={[{ type: 4 }, { type: 2 }]} />);
    expect(screen.queryByText(/Waiting for the first full snapshot/)).toBeNull();
    expect(container.querySelector('.crosspane-player')).toBeTruthy();
  });

  it('ResizeObserver가 없는 환경에서도 마운트가 죽지 않는다', () => {
    // jsdom에는 ResizeObserver가 없다 — 이 테스트가 통과하는 것 자체가 방어 확인
    expect(typeof ResizeObserver).toBe('undefined');
    expect(() => render(<ScreenPanel events={[{ type: 4 }, { type: 2 }]} />)).not.toThrow();
  });
});
