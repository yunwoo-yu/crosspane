import { devices } from 'playwright';

export interface Viewport {
  width: number;
  height: number;
}

export function resolveDevice(name: string): Viewport {
  const preset = devices[name];
  if (!preset) {
    const known = Object.keys(devices)
      .filter((d) => /iPhone|Pixel|Galaxy|iPad/.test(d))
      .slice(0, 20)
      .join(', ');
    throw new Error(`Unknown device "${name}". Examples: ${known}`);
  }
  return { width: preset.viewport.width, height: preset.viewport.height };
}
