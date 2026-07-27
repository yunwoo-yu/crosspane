import { describe, expect, it } from 'vitest';
import { resolvePaneSetup } from '../src/pane-setup';

const base = {
  autoStartEngines: ['chromium', 'webkit'] as ('chromium' | 'webkit' | 'firefox')[],
  autoStartRealDevices: false,
  iosAvailable: true,
  androidAvailable: true,
};

describe('resolvePaneSetup', () => {
  it('webview 프로필: 브라우저 3종 pane 표시, 2종만 자동 시작, 실기기는 stopped로 표시', () => {
    const setup = resolvePaneSetup(base);
    expect(setup.panes).toEqual(['chromium', 'webkit', 'firefox', 'android', 'ios-sim']);
    expect(setup.autoStart).toEqual(['chromium', 'webkit']);
    expect(setup.viewOnly).toEqual(['ios-sim']);
  });

  it('device 프로필: 실기기도 자동 시작', () => {
    const setup = resolvePaneSetup({ ...base, autoStartRealDevices: true });
    expect(setup.autoStart).toEqual(['chromium', 'webkit', 'android', 'ios-sim']);
  });

  it('--android 강제 플래그는 프로필과 무관하게 자동 시작', () => {
    const setup = resolvePaneSetup({ ...base, android: true });
    expect(setup.autoStart).toContain('android');
    expect(setup.autoStart).not.toContain('ios-sim');
  });

  it('--no-ios-sim은 pane 자체를 제외한다', () => {
    const setup = resolvePaneSetup({ ...base, iosSimulator: false });
    expect(setup.panes).not.toContain('ios-sim');
    expect(setup.viewOnly).toEqual([]);
  });

  it('SDK가 없으면 pane에서 빠진다 (강제 플래그여도)', () => {
    const setup = resolvePaneSetup({
      ...base,
      android: true,
      androidAvailable: false,
      iosAvailable: false,
    });
    expect(setup.panes).toEqual(['chromium', 'webkit', 'firefox']);
    expect(setup.autoStart).toEqual(['chromium', 'webkit']);
  });
});
