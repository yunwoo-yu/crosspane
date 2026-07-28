import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVideoStreams } from '../src/hooks/useVideoStreams';

// jsdom에는 WebCodecs가 없다 — 스텁 없이는 훅이 통째로 no-op이 되어
// 테스트가 조용히 통과해 버린다 (pushVideoChunk의 typeof VideoDecoder 가드)
class FakeVideoDecoder {
  static instances: FakeVideoDecoder[] = [];
  state = 'configured';
  configured: unknown = null;
  decoded: { type: string }[] = [];
  constructor(readonly init: { output: (frame: unknown) => void; error: (err: unknown) => void }) {
    FakeVideoDecoder.instances.push(this);
  }
  configure(config: unknown): void {
    this.configured = config;
  }
  decode(chunk: { type: string }): void {
    this.decoded.push(chunk);
  }
  close(): void {
    this.state = 'closed';
  }
}
class FakeEncodedVideoChunk {
  type: string;
  constructor(init: { type: string }) {
    this.type = init.type;
  }
}

// [시작코드][NAL] 빌더 — h264.test.ts와 동일 규약
const nal = (type: number, ...payload: number[]) => [type & 0x1f, ...payload];
const sc = [0, 0, 0, 1];
const SPS = nal(7, 0x64, 0x00, 0x28, 0xaa);
const PPS = nal(8, 0xee);
const IDR = nal(5, 0x88, 0x22);
const P_FRAME = nal(1, 0x99);
const bytes = (...parts: number[][]) => new Uint8Array(parts.flat());

describe('useVideoStreams (H.264 파이프라인 수명주기)', () => {
  beforeEach(() => {
    FakeVideoDecoder.instances = [];
    vi.stubGlobal('VideoDecoder', FakeVideoDecoder);
    vi.stubGlobal('EncodedVideoChunk', FakeEncodedVideoChunk);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('SPS 도착 전에는 디코더를 만들지 않고, 키프레임 전의 델타는 버린다', () => {
    const { result } = renderHook(() => useVideoStreams(vi.fn()));
    // SPS 없이 P프레임만 두 번 → 완결된 첫 유닛이 나와도 디코더 미생성
    result.current.pushVideoChunk('android', bytes(sc, P_FRAME, sc, P_FRAME, sc, P_FRAME));
    expect(FakeVideoDecoder.instances).toHaveLength(0);

    // SPS/PPS/IDR 도착 → 디코더 설정 + 키프레임부터 디코드 시작
    result.current.pushVideoChunk(
      'android',
      bytes(sc, SPS, sc, PPS, sc, IDR, sc, P_FRAME, sc, P_FRAME),
    );
    expect(FakeVideoDecoder.instances).toHaveLength(1);
    const decoder = FakeVideoDecoder.instances[0];
    expect(decoder.decoded[0]?.type).toBe('key'); // 첫 디코드는 반드시 키프레임
  });

  it('resetPipeline은 디코더를 닫고, 다음 청크는 새 파이프라인으로 시작한다', () => {
    const { result } = renderHook(() => useVideoStreams(vi.fn()));
    result.current.pushVideoChunk(
      'android',
      bytes(sc, SPS, sc, PPS, sc, IDR, sc, P_FRAME, sc, P_FRAME),
    );
    const first = FakeVideoDecoder.instances[0];

    result.current.resetPipeline('android');
    expect(first.state).toBe('closed');

    result.current.pushVideoChunk(
      'android',
      bytes(sc, SPS, sc, PPS, sc, IDR, sc, P_FRAME, sc, P_FRAME),
    );
    expect(FakeVideoDecoder.instances).toHaveLength(2); // 새 디코더
  });

  it('디코더 error 콜백이 파이프라인 리셋 + onStreamError(재시작 요청)를 부른다', () => {
    const onStreamError = vi.fn();
    const { result } = renderHook(() => useVideoStreams(vi.fn(), onStreamError));
    result.current.pushVideoChunk(
      'android',
      bytes(sc, SPS, sc, PPS, sc, IDR, sc, P_FRAME, sc, P_FRAME),
    );
    const decoder = FakeVideoDecoder.instances[0];

    decoder.init.error(new Error('decode failed'));
    expect(decoder.state).toBe('closed');
    expect(onStreamError).toHaveBeenCalledWith('android');
  });

  it('언마운트 시 모든 엔진의 디코더를 닫는다', () => {
    const { result, unmount } = renderHook(() => useVideoStreams(vi.fn()));
    result.current.pushVideoChunk(
      'android',
      bytes(sc, SPS, sc, PPS, sc, IDR, sc, P_FRAME, sc, P_FRAME),
    );
    result.current.pushVideoChunk(
      'ios-sim',
      bytes(sc, SPS, sc, PPS, sc, IDR, sc, P_FRAME, sc, P_FRAME),
    );
    unmount();
    for (const decoder of FakeVideoDecoder.instances) expect(decoder.state).toBe('closed');
  });
});
