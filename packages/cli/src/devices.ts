import { devices } from 'playwright';

export interface Viewport {
  width: number;
  height: number;
}

/** Playwright 기기 프리셋 이름을 CSS 픽셀 뷰포트로 해석한다 */
export function resolveDeviceViewport(deviceName: string): Viewport {
  const preset = devices[deviceName];
  if (!preset) {
    const examples = Object.keys(devices)
      .filter((name) => /iPhone|Pixel|Galaxy|iPad/.test(name))
      .slice(0, 20)
      .join(', ');
    throw new Error(`Unknown device "${deviceName}". Examples: ${examples}`);
  }
  return { width: preset.viewport.width, height: preset.viewport.height };
}
