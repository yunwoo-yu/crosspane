import { describe, expect, it } from 'vitest';
import { encodeFramePacket, encodeVideoPacket } from '../src/frame-packet';
import {
  ENGINE_CODES,
  type EngineName,
  FRAME_HEADER_BYTES,
  PACKET_TYPE_FRAME,
  PACKET_TYPE_VIDEO,
  VIDEO_HEADER_BYTES,
} from '../src/protocol';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

describe('encodeFramePacket', () => {
  it('규약 헤더([type][engine][flags][scrollY])와 JPEG 본문을 인코딩한다', () => {
    const packet = encodeFramePacket('webkit', JPEG, 1234, 1);
    expect(packet.readUInt8(0)).toBe(PACKET_TYPE_FRAME);
    expect(packet.readUInt8(1)).toBe(ENGINE_CODES.webkit);
    expect(packet.readUInt8(2)).toBe(1);
    expect(packet.readInt32LE(3)).toBe(1234);
    expect(packet.subarray(FRAME_HEADER_BYTES).equals(JPEG)).toBe(true);
  });

  it('scrollY 미상(-1)과 소수 scrollY 반올림을 처리한다', () => {
    expect(encodeFramePacket('chromium', JPEG, -1).readInt32LE(3)).toBe(-1);
    expect(encodeFramePacket('chromium', JPEG, 10.6).readInt32LE(3)).toBe(11);
  });

  it('모든 엔진 코드가 왕복된다 (새 엔진 추가 시 회귀 감지)', () => {
    for (const engine of Object.keys(ENGINE_CODES) as EngineName[]) {
      expect(encodeFramePacket(engine, JPEG, 0).readUInt8(1)).toBe(ENGINE_CODES[engine]);
    }
  });
});

describe('encodeVideoPacket', () => {
  it('규약 헤더([type][engine])와 H.264 바이트를 그대로 전달한다', () => {
    const chunk = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x67]);
    const packet = encodeVideoPacket('android', chunk);
    expect(packet.readUInt8(0)).toBe(PACKET_TYPE_VIDEO);
    expect(packet.readUInt8(1)).toBe(ENGINE_CODES.android);
    expect(packet.subarray(VIDEO_HEADER_BYTES).equals(chunk)).toBe(true);
  });
});
