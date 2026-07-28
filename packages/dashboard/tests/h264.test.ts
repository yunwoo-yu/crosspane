import { describe, expect, it } from 'vitest';
import { codecStringFromSps, H264AnnexBParser, MAX_PENDING_BYTES } from '../src/h264';

// [시작코드][NAL] 빌더 — 타입만 의미 있는 최소 NAL
const nal = (type: number, ...payload: number[]) => [type & 0x1f, ...payload];
const sc4 = [0, 0, 0, 1];
const sc3 = [0, 0, 1];
const SPS = nal(7, 0x64, 0x00, 0x28, 0xaa); // profile 0x64, level 0x28
const PPS = nal(8, 0xee);
const IDR = nal(5, 0x88, 0x22); // 0x88: first_mb_in_slice=0
const P_FRAME = nal(1, 0x99); // MSB 1 = 새 픽처

const bytes = (...parts: number[][]) => new Uint8Array(parts.flat());
/** 스트림 종료까지 흘려보내고 남은 프레임까지 회수 (AU는 다음 픽처 도착 시 방출됨) */
const drain = (parser: H264AnnexBParser, data: Uint8Array) => [
  ...parser.push(data),
  ...parser.flushPending(),
];

describe('H264AnnexBParser', () => {
  it('SPS/PPS를 흡수하고 IDR을 키프레임 유닛으로 만든다 (SPS/PPS 동봉)', () => {
    const parser = new H264AnnexBParser();
    const units = drain(parser, bytes(sc4, SPS, sc4, PPS, sc4, IDR, sc4, P_FRAME));
    expect(units).toHaveLength(2); // IDR 유닛 + 마지막 P(플러시)
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
    units = units.concat(parser.flushPending());
    expect(units).toHaveLength(3); // IDR + P + P(플러시)
    expect(units[0].isKeyframe).toBe(true);
    expect(units[1].isKeyframe).toBe(false);
  });

  it('P프레임은 델타 유닛 — SPS/PPS를 붙이지 않는다', () => {
    const parser = new H264AnnexBParser();
    const units = drain(parser, bytes(sc4, SPS, sc4, PPS, sc4, IDR, sc4, P_FRAME, sc4, P_FRAME));
    expect(units).toHaveLength(3);
    expect(units[1].isKeyframe).toBe(false);
    expect(units[1].data[4] & 0x1f).toBe(1); // 시작 코드 바로 뒤가 P NAL
  });
});

describe('pending 버퍼 상한 (손상 스트림 방어)', () => {
  it('시작 코드 없는 청크가 상한을 넘으면 버리고, 다음 시작 코드부터 재동기화한다', () => {
    const parser = new H264AnnexBParser();
    // 시작 코드가 전혀 없는 손상 데이터로 상한 초과까지 밀어넣는다
    const junk = new Uint8Array(1024 * 1024).fill(0x55);
    for (let i = 0; i < 5; i++) expect(parser.push(junk)).toEqual([]);
    // 상한 초과 시 pending이 버려져 무한 성장하지 않는다
    expect(parser.pendingBytes).toBeLessThanOrEqual(MAX_PENDING_BYTES);
    // 이후 정상 스트림이 오면 다시 프레임이 나온다
    const units = drain(parser, bytes(sc4, SPS, sc4, PPS, sc4, IDR, sc4, P_FRAME));
    expect(units.some((unit) => unit.isKeyframe)).toBe(true);
  });
});

describe('멀티 슬라이스 프레임 (Apple 인코더)', () => {
  it('first_mb!=0 슬라이스는 같은 유닛으로 누적된다', () => {
    const parser = new H264AnnexBParser();
    const SLICE2 = nal(5, 0x22); // MSB 0 → 같은 픽처의 후속 슬라이스
    const units = drain(
      parser,
      bytes(sc4, SPS, sc4, PPS, sc4, IDR, sc4, SLICE2, sc4, P_FRAME, sc4, P_FRAME),
    );
    // IDR+SLICE2가 한 유닛, P 둘이 각각 유닛
    expect(units).toHaveLength(3);
    expect(units[0].isKeyframe).toBe(true);
    const vclCount = [...units[0].data.join(',').matchAll(/(?:^|,)0,0,0,1,(\d+)/g)].filter(
      (m) => (Number(m[1]) & 0x1f) === 5,
    ).length;
    expect(vclCount).toBe(2); // 슬라이스 2개 동봉
  });
});

describe('codecStringFromSps', () => {
  it('profile/constraint/level을 hex로 조합한다', () => {
    expect(codecStringFromSps(new Uint8Array([0x67, 0x42, 0xc0, 0x1f]))).toBe('avc1.42c01f');
  });
});
