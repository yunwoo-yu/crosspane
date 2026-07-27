import { describe, expect, it } from 'vitest';
import { encodeFramePacket, encodeVideoPacket } from '../src/frame-packet';
import {
  ENGINE_CODES,
  FRAME_HEADER_BYTES,
  PACKET_TYPE_FRAME,
  PACKET_TYPE_VIDEO,
  VIDEO_HEADER_BYTES,
} from '../src/protocol';

describe('encodeVideoPacket', () => {
  it('[type=VIDEO][엔진코드] 뒤에 H.264 바이트를 그대로 붙인다', () => {
    const chunk = Buffer.from([0, 0, 0, 1, 0x67]);
    const packet = encodeVideoPacket('android', chunk);
    expect(packet[0]).toBe(PACKET_TYPE_VIDEO);
    expect(packet[1]).toBe(ENGINE_CODES.android);
    expect(packet.subarray(VIDEO_HEADER_BYTES)).toEqual(chunk);
  });
});

describe('encodeFramePacket', () => {
  it('[엔진코드 u8][scrollY int32LE][JPEG] 형식으로 인코딩한다', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff]);
    const packet = encodeFramePacket('webkit', jpeg, 1234);

    expect(packet[0]).toBe(PACKET_TYPE_FRAME);
    expect(packet[1]).toBe(ENGINE_CODES.webkit);
    expect(packet[2]).toBe(0); // flags 기본값
    expect(packet.readInt32LE(3)).toBe(1234);
    expect(packet.subarray(FRAME_HEADER_BYTES)).toEqual(jpeg);
  });

  it('scrollY 음수(-1 = 알 수 없음)도 그대로 보존한다', () => {
    const packet = encodeFramePacket('ios-sim', Buffer.from([1]), -1);
    expect(packet[0]).toBe(PACKET_TYPE_FRAME);
    expect(packet[1]).toBe(ENGINE_CODES['ios-sim']);
    expect(packet.readInt32LE(3)).toBe(-1);
  });
});
