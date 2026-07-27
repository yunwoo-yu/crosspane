import type { BrowserEngineName, EngineName } from './protocol.js';

const ALL_BROWSER_ENGINES: readonly BrowserEngineName[] = ['chromium', 'webkit', 'firefox'];

export interface PaneSetupInput {
  /** 자동 시작할 브라우저 엔진 (프로필/--engines) */
  autoStartEngines: BrowserEngineName[];
  /** 프로필이 실기기 pane을 자동 시작하는지 */
  autoStartRealDevices: boolean;
  /** true=강제 시작, false=제외, undefined=SDK 있으면 표시 */
  iosSimulator?: boolean;
  android?: boolean;
  iosAvailable: boolean;
  androidAvailable: boolean;
}

export interface PaneSetup {
  /** 대시보드에 표시할 모든 pane (실행 여부 무관) */
  panes: EngineName[];
  /** 기동 시 자동 시작할 pane — 나머지는 stopped 상태로 표시되며 대시보드에서 시작 가능 */
  autoStart: EngineName[];
  viewOnly: EngineName[];
}

/**
 * pane 구성 규칙:
 * - 브라우저 엔진 3종은 항상 pane으로 표시 (프로필은 자동 시작 대상만 결정)
 * - 실기기는 SDK가 있으면 표시, 자동 시작은 device/full 프로필 또는 강제 플래그일 때만
 *   (부팅 비용이 커서 기본은 "필요할 때 대시보드에서 시작")
 */
export function resolvePaneSetup(input: PaneSetupInput): PaneSetup {
  const panes: EngineName[] = [...ALL_BROWSER_ENGINES];
  const autoStart: EngineName[] = [...input.autoStartEngines];

  const includeAndroid = input.android !== false && input.androidAvailable;
  if (includeAndroid) {
    panes.push('android');
    if (input.android === true || input.autoStartRealDevices) autoStart.push('android');
  }

  const includeIos = input.iosSimulator !== false && input.iosAvailable;
  if (includeIos) {
    panes.push('ios-sim');
    if (input.iosSimulator === true || input.autoStartRealDevices) autoStart.push('ios-sim');
  }

  return { panes, autoStart, viewOnly: includeIos ? ['ios-sim'] : [] };
}
