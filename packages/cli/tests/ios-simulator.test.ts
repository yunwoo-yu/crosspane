import { describe, expect, it } from 'vitest';
import { chooseSimulatorDevice, listIosRuntimes } from '../src/ios-simulator';

const fixture = JSON.stringify({
  devices: {
    'com.apple.CoreSimulator.SimRuntime.iOS-17-2': [
      { udid: 'A', name: 'iPhone 15', state: 'Shutdown', isAvailable: true },
      { udid: 'B', name: 'iPad Air (5th generation)', state: 'Shutdown', isAvailable: true },
    ],
    'com.apple.CoreSimulator.SimRuntime.iOS-18-5': [
      { udid: 'C', name: 'iPhone 15 Pro', state: 'Shutdown', isAvailable: true },
      { udid: 'D', name: 'iPhone 14', state: 'Shutdown', isAvailable: false },
    ],
    'com.apple.CoreSimulator.SimRuntime.watchOS-11-0': [
      { udid: 'E', name: 'Apple Watch Series 10', state: 'Shutdown', isAvailable: true },
    ],
  },
});

describe('chooseSimulatorDevice', () => {
  it('최신 iOS 런타임의 iPhone을 고른다 (iPad/watchOS/미사용 기기 제외)', () => {
    const device = chooseSimulatorDevice(fixture);
    expect(device).toMatchObject({ udid: 'C', name: 'iPhone 15 Pro', runtime: 'iOS-18-5' });
  });

  it('이미 부팅된 기기가 있으면 런타임과 무관하게 우선한다 (부팅 시간 절약)', () => {
    const withBooted = fixture.replace(
      '"udid":"A","name":"iPhone 15","state":"Shutdown"',
      '"udid":"A","name":"iPhone 15","state":"Booted"',
    );
    expect(chooseSimulatorDevice(withBooted)?.udid).toBe('A');
  });

  it('iPhone이 없으면 undefined', () => {
    expect(chooseSimulatorDevice(JSON.stringify({ devices: {} }))).toBeUndefined();
  });

  it('--ios-runtime 지정 시 해당 런타임만 고른다 (구버전 iOS 재현)', () => {
    expect(chooseSimulatorDevice(fixture, '17.2')?.udid).toBe('A');
    expect(chooseSimulatorDevice(fixture, '16.0')).toBeUndefined();
  });
});

describe('listIosRuntimes', () => {
  it('설치된 iOS 런타임 버전 목록을 돌려준다', () => {
    expect(listIosRuntimes(fixture)).toEqual(['17.2', '18.5']);
  });
});
