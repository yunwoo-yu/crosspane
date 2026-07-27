import { describe, expect, it } from 'vitest';
import { codecStringFromSps, H264AnnexBParser } from '../src/h264';

// [시작코드][NAL] 빌더 — 타입만 의미 있는 최소 NAL
const nal = (type: number, ...payload: number[]) => [type & 0x1f, ...payload];
const sc4 = [0, 0, 0, 1];
const sc3 = [0, 0, 1];
const SPS = nal(7, 0x64, 0x00, 0x28, 0xaa); // profile 0x64, level 0x28
const PPS = nal(8, 0xee);
const IDR = nal(5, 0x11, 0x22);
const P_FRAME = nal(1, 0x33);

const bytes = (...parts: number[][]) => new Uint8Array(parts.flat());

describe('H264AnnexBParser', () => {
  it('SPS/PPS를 흡수하고 IDR을 키프레임 유닛으로 만든다 (SPS/PPS 동봉)', () => {
    const parser = new H264AnnexBParser();
    // 마지막 NAL은 다음 시작 코드가 와야 완결된다 — 후속 P로 IDR을 밀어낸다
    const units = parser.push(bytes(sc4, SPS, sc4, PPS, sc4, IDR, sc4, P_FRAME));
    expect(units).toHaveLength(1);
    expect(units[0].isKeyframe).toBe(true);
    // 유닛 안에 SPS(7)·PPS(8)·IDR(5)이 모두 들어 있다
    const types = [...units[0].data.join(',').matchAll(/(?:^|,)0,0,0,1,(\d+)/g)].map(
      (m) => Number(m[1]) & 0x1f,
    );
    expect(types).toEqual([7, 8, 5]);
    expect(parser.codec).toBe('avc1.640028');
  });

  it('임의 위치에서 잘린 조각도 재조립한다 (스트리밍 경계)', () => {
    const parser = new H264AnnexBParser();
    const stream = bytes(sc4, SPS, sc4, PPS, sc4, IDR, sc3, P_FRAME, sc4, P_FRAME);
    let units: ReturnType<typeof parser.push> = [];
    // 3바이트씩 잘라 밀어 넣는다
    for (let i = 0; i < stream.length; i += 3) {
      units = units.concat(parser.push(stream.subarray(i, i + 3)));
    }
    expect(units).toHaveLength(2); // IDR + 첫 P (마지막 P는 미완로 보류)
    expect(units[0].isKeyframe).toBe(true);
    expect(units[1].isKeyframe).toBe(false);
  });

  it('P프레임은 델타 유닛 — SPS/PPS를 붙이지 않는다', () => {
    const parser = new H264AnnexBParser();
    const units = parser.push(bytes(sc4, SPS, sc4, PPS, sc4, IDR, sc4, P_FRAME, sc4, P_FRAME));
    expect(units).toHaveLength(2);
    expect(units[1].isKeyframe).toBe(false);
    expect(units[1].data[4] & 0x1f).toBe(1); // 시작 코드 바로 뒤가 P NAL
  });
});

describe('codecStringFromSps', () => {
  it('profile/constraint/level을 hex로 조합한다', () => {
    expect(codecStringFromSps(new Uint8Array([0x67, 0x42, 0xc0, 0x1f]))).toBe('avc1.42c01f');
  });
});
