import {
  ENGINE_CODES,
  type EngineName,
  FRAME_HEADER_BYTES,
  PACKET_TYPE_FRAME,
  PACKET_TYPE_RAW,
  PACKET_TYPE_VIDEO,
  RAW_HEADER_BYTES,
  VIDEO_HEADER_BYTES,
} from './protocol.js';

/** 프레임(스냅샷) 패킷 인코더 — Buffer를 쓰므로 Node 전용 (규약은 protocol.ts 참조) */
export function encodeFramePacket(
  engine: EngineName,
  jpeg: Buffer,
  scrollY: number,
  flags = 0,
): Buffer {
  const header = Buffer.alloc(FRAME_HEADER_BYTES);
  header.writeUInt8(PACKET_TYPE_FRAME, 0);
  header.writeUInt8(ENGINE_CODES[engine], 1);
  header.writeUInt8(flags, 2);
  header.writeInt32LE(Math.round(scrollY), 3);
  return Buffer.concat([header, jpeg]);
}

/** RAW RGBA 프레임 패킷 인코더 — gRPC 스트림 직결용 (인코딩 없음) */
export function encodeRawPacket(
  engine: EngineName,
  rgba: Buffer,
  width: number,
  height: number,
): Buffer {
  const header = Buffer.alloc(RAW_HEADER_BYTES);
  header.writeUInt8(PACKET_TYPE_RAW, 0);
  header.writeUInt8(ENGINE_CODES[engine], 1);
  header.writeUInt16LE(width, 2);
  header.writeUInt16LE(height, 4);
  return Buffer.concat([header, rgba]);
}

/** 비디오 스트림 조각 패킷 인코더 — H.264 Annex-B 바이트를 그대로 전달한다 */
export function encodeVideoPacket(engine: EngineName, chunk: Buffer): Buffer {
  const header = Buffer.alloc(VIDEO_HEADER_BYTES);
  header.writeUInt8(PACKET_TYPE_VIDEO, 0);
  header.writeUInt8(ENGINE_CODES[engine], 1);
  return Buffer.concat([header, chunk]);
}
