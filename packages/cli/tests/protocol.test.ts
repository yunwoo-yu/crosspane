import { describe, expect, it } from 'vitest';
import { encodeFramePacket } from '../src/frame-packet';
import { ENGINE_CODES, FRAME_HEADER_BYTES } from '../src/protocol';

describe('encodeFramePacket', () => {
  it('[엔진코드 u8][scrollY int32LE][JPEG] 형식으로 인코딩한다', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff]);
    const packet = encodeFramePacket('webkit', jpeg, 1234);

    expect(packet[0]).toBe(ENGINE_CODES.webkit);
    expect(packet.readInt32LE(1)).toBe(1234);
    expect(packet.subarray(FRAME_HEADER_BYTES)).toEqual(jpeg);
  });

  it('scrollY 음수(-1 = 알 수 없음)도 그대로 보존한다', () => {
    const packet = encodeFramePacket('ios-sim', Buffer.from([1]), -1);
    expect(packet[0]).toBe(ENGINE_CODES['ios-sim']);
    expect(packet.readInt32LE(1)).toBe(-1);
  });
});
