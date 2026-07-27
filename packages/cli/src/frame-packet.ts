import { ENGINE_CODES, type EngineName, FRAME_HEADER_BYTES } from './protocol.js';

/** 프레임 패킷 인코더 — Buffer를 쓰므로 Node 전용 (규약은 protocol.ts 참조) */
export function encodeFramePacket(engine: EngineName, jpeg: Buffer, scrollY: number): Buffer {
  const header = Buffer.alloc(FRAME_HEADER_BYTES);
  header.writeUInt8(ENGINE_CODES[engine], 0);
  header.writeInt32LE(Math.round(scrollY), 1);
  return Buffer.concat([header, jpeg]);
}
