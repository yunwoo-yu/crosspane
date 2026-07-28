import { useEffect, useRef, useState } from 'react';
import { computePixelDiff, formatMismatchRatio, type PixelDiffResult } from '../diff-utils';
import type { EngineName } from '../types';
import { Button } from './ui/button';

interface DiffPanelProps {
  /** 비교 후보 — 실행 중이며 프레임이 있는 엔진만 의미가 있다 */
  engines: EngineName[];
  /** pane의 실제 canvas 조회 (프레임은 React 상태에 없으므로 canvas가 원본이다) */
  getPaneCanvas: (engine: EngineName) => HTMLCanvasElement | null;
}

/** 두 canvas를 같은 크기로 스케일해 ImageData를 뽑는다 */
function extractImageData(
  a: HTMLCanvasElement,
  b: HTMLCanvasElement,
): { a: ImageData; b: ImageData; width: number; height: number } | null {
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  if (width === 0 || height === 0) return null;
  const scratch = document.createElement('canvas');
  scratch.width = width;
  scratch.height = height;
  const context = scratch.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(a, 0, 0, width, height);
  const dataA = context.getImageData(0, 0, width, height);
  context.clearRect(0, 0, width, height);
  context.drawImage(b, 0, 0, width, height);
  const dataB = context.getImageData(0, 0, width, height);
  return { a: dataA, b: dataB, width, height };
}

/**
 * 엔진 간 렌더링 diff 패널 — 두 pane의 현재 프레임을 픽셀 비교해
 * 다른 영역을 빨간색으로 하이라이트한다.
 */
export function DiffPanel({ engines, getPaneCanvas }: DiffPanelProps) {
  const [engineA, setEngineA] = useState<EngineName | ''>('');
  const [engineB, setEngineB] = useState<EngineName | ''>('');
  const [result, setResult] = useState<PixelDiffResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const diffCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // 엔진 목록이 바뀌면 기본 선택을 앞의 두 엔진으로
  useEffect(() => {
    setEngineA((current) => (current && engines.includes(current) ? current : (engines[0] ?? '')));
    setEngineB((current) => (current && engines.includes(current) ? current : (engines[1] ?? '')));
  }, [engines]);

  const runCompare = (): void => {
    setError(null);
    setResult(null);
    if (!engineA || !engineB || engineA === engineB) {
      setError('Select two different engines');
      return;
    }
    const canvasA = getPaneCanvas(engineA);
    const canvasB = getPaneCanvas(engineB);
    if (!canvasA || !canvasB) {
      setError('Both engines need a frame (check that the panes are running)');
      return;
    }
    const extracted = extractImageData(canvasA, canvasB);
    if (!extracted) {
      setError('Could not read frames');
      return;
    }
    const diffResult = computePixelDiff(extracted.a, extracted.b);
    setResult(diffResult);
    const target = diffCanvasRef.current;
    if (target) {
      target.width = extracted.width;
      target.height = extracted.height;
      target
        .getContext('2d')
        ?.putImageData(new ImageData(diffResult.diff, extracted.width, extracted.height), 0, 0);
    }
  };

  const selectClass =
    'h-7 rounded border border-line bg-panel px-2 text-fg text-xs focus:border-accent focus:outline-none';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-line border-b px-4 py-2 text-xs">
        <select
          className={selectClass}
          value={engineA}
          onChange={(event) => setEngineA(event.target.value as EngineName)}
          aria-label="diff engine A"
        >
          {engines.map((engine) => (
            <option key={engine} value={engine}>
              {engine}
            </option>
          ))}
        </select>
        <span className="text-fg-muted">vs</span>
        <select
          className={selectClass}
          value={engineB}
          onChange={(event) => setEngineB(event.target.value as EngineName)}
          aria-label="diff engine B"
        >
          {engines.map((engine) => (
            <option key={engine} value={engine}>
              {engine}
            </option>
          ))}
        </select>
        <Button variant="default" size="icon" onClick={runCompare}>
          Compare
        </Button>
        {result && (
          <span className={result.mismatchRatio > 0.001 ? 'font-semibold text-warn' : 'text-fg'}>
            Diff {formatMismatchRatio(result.mismatchRatio)} (
            {result.mismatchedPixels.toLocaleString()}px)
          </span>
        )}
        {error && <span className="text-danger">{error}</span>}
        <span className="ml-auto text-fg-muted">
          Red = pixels that differ between the two engines
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-app/60 p-2">
        <canvas
          ref={diffCanvasRef}
          role="img"
          aria-label="pixel diff"
          className="mx-auto block max-h-full"
          style={{ display: result ? 'block' : 'none' }}
        />
        {!result && (
          <div className="flex h-full items-center justify-center text-fg-muted text-sm">
            Pick two engines and hit Compare to highlight rendering differences
          </div>
        )}
      </div>
    </div>
  );
}
