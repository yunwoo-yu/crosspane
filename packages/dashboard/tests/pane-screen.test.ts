import { describe, expect, it } from 'vitest';
import { PaneScreen } from '../src/pane-screen';
import type { PaneFrame } from '../src/types';

// jsdom엔 2D 컨텍스트가 없어 드로우는 transform 폴백으로 빠진다 —
// 여기서는 에코 모드 전이(강등/승격) 규칙만 검증한다
const viewport = { width: 390, height: 659 };
const frame = { width: 390, height: 659, close: () => undefined } as unknown as PaneFrame;

describe('PaneScreen 에코 모드 전이', () => {
  it('scrollY 미상(-1) 프레임이 오면 절대 에코를 상대 에코로 강등한다', () => {
    const screen = new PaneScreen(viewport, 'absolute');
    const canvas = document.createElement('canvas');
    screen.acceptFrame(canvas, frame, -1, false, 0);
    expect(screen.mode).toBe('relative');
  });

  it('유효 scrollY가 3연속 복귀하면 절대 에코로 승격 복구한다', () => {
    const screen = new PaneScreen(viewport, 'absolute');
    const canvas = document.createElement('canvas');
    screen.acceptFrame(canvas, frame, -1, false, 0);
    screen.acceptFrame(canvas, frame, 10, false, 1);
    screen.acceptFrame(canvas, frame, 20, false, 2);
    expect(screen.mode).toBe('relative'); // 아직 2연속
    screen.acceptFrame(canvas, frame, 30, false, 3);
    expect(screen.mode).toBe('absolute');
  });

  it('중간에 미상 프레임이 끼면 연속 카운트가 리셋된다', () => {
    const screen = new PaneScreen(viewport, 'absolute');
    const canvas = document.createElement('canvas');
    screen.acceptFrame(canvas, frame, -1, false, 0);
    screen.acceptFrame(canvas, frame, 10, false, 1);
    screen.acceptFrame(canvas, frame, 20, false, 2);
    screen.acceptFrame(canvas, frame, -1, false, 3); // 리셋
    screen.acceptFrame(canvas, frame, 10, false, 4);
    screen.acceptFrame(canvas, frame, 20, false, 5);
    screen.acceptFrame(canvas, frame, 30, false, 6);
    expect(screen.mode).toBe('absolute'); // 리셋 후 다시 3연속
  });

  it('상대 에코로 시작한 실기기 pane은 유효 scrollY가 와도 승격하지 않는다', () => {
    const screen = new PaneScreen(viewport, 'relative');
    const canvas = document.createElement('canvas');
    for (let i = 0; i < 5; i++) screen.acceptFrame(canvas, frame, i * 10, false, i);
    expect(screen.mode).toBe('relative');
  });
});
