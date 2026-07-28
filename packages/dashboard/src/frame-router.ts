import {
  ENGINE_NAMES_BY_CODE,
  type EngineName,
  FRAME_FLAG_FULL_PAGE,
  FRAME_HEADER_BYTES,
  PACKET_TYPE_FRAME,
  PACKET_TYPE_RAW,
  PACKET_TYPE_VIDEO,
  RAW_HEADER_BYTES,
  SCROLL_Y_UNKNOWN,
  VIDEO_HEADER_BYTES,
} from './types';

export interface FrameRouterSinks {
  /** 이 엔진을 그리는 구독자(canvas)가 있는가 — 없으면 디코딩/복사 자체를 생략 (숨김 pane 비용 0) */
  hasSubscribers(engine: EngineName): boolean;
  dispatchFrame(
    engine: EngineName,
    frame: ImageBitmap | ImageData,
    scrollY: number,
    fullPage?: boolean,
  ): void;
  pushVideoChunk(engine: EngineName, chunk: Uint8Array): void;
}

/** WS 바이너리 패킷(FRAME/VIDEO/RAW)을 파싱해 알맞은 싱크로 보낸다 */
export function routeBinaryPacket(packet: ArrayBuffer, sinks: FrameRouterSinks): void {
  const bytes = new Uint8Array(packet);
  const engine = ENGINE_NAMES_BY_CODE[bytes[1]];
  if (!engine) return;

  if (bytes[0] === PACKET_TYPE_RAW) {
    if (!sinks.hasSubscribers(engine)) return;
    // RAW RGBA — 디코딩 제로: ImageData로 감싸 바로 그린다
    const view = new DataView(packet);
    const width = view.getUint16(2, true);
    const height = view.getUint16(4, true);
    const pixels = new Uint8ClampedArray(packet, RAW_HEADER_BYTES);
    if (pixels.length >= width * height * 4) {
      sinks.dispatchFrame(
        engine,
        new ImageData(pixels.slice(0, width * height * 4), width, height),
        SCROLL_Y_UNKNOWN,
      );
    }
    return;
  }

  if (bytes[0] === PACKET_TYPE_VIDEO) {
    // 비디오는 구독자 게이트를 걸지 않는다 — 델타 스트림이라 중간을 버리면
    // 재구독 시 키프레임까지 화면이 깨진다 (게이트는 디코더 쪽 소관)
    if (bytes.length > VIDEO_HEADER_BYTES)
      sinks.pushVideoChunk(engine, bytes.subarray(VIDEO_HEADER_BYTES));
    return;
  }

  if (bytes[0] !== PACKET_TYPE_FRAME || bytes.length <= FRAME_HEADER_BYTES) return;
  if (!sinks.hasSubscribers(engine)) return;
  // 헤더: flags(bit0=풀페이지) + scrollY(이 프레임이 반영하는 실제 스크롤 위치)
  const fullPage = (bytes[2] & FRAME_FLAG_FULL_PAGE) !== 0;
  const scrollY = new DataView(packet).getInt32(3, true);
  const jpegBlob = new Blob([bytes.subarray(FRAME_HEADER_BYTES)], { type: 'image/jpeg' });
  // createImageBitmap은 디코딩을 메인 스레드 밖에서 수행한다
  void createImageBitmap(jpegBlob)
    .then((frame) => sinks.dispatchFrame(engine, frame, scrollY, fullPage))
    .catch(() => undefined); // 손상 JPEG 1장이 unhandled rejection이 되지 않게
}
