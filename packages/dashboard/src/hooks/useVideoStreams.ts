import { useCallback, useEffect, useRef } from 'react';
import { type H264AccessUnit, H264AnnexBParser } from '../h264';
import type { EngineName } from '../types';

/** 디코딩된 비디오 프레임을 기존 프레임 구독 경로로 넘긴다 (VideoFrame 직행 — 변환 왕복 없음) */
export type DecodedFrameSink = (engine: EngineName, frame: VideoFrame) => void;

const FRAME_DURATION_US = 33_333; // 타임스탬프 용도 (30fps 가정, 표시 타이밍엔 미사용)

interface EngineVideoPipeline {
  parser: H264AnnexBParser;
  decoder: VideoDecoder | null;
  configured: boolean;
  sawKeyframe: boolean;
  timestamp: number;
}

/**
 * 엔진별 H.264 스트림 → WebCodecs 디코드 파이프라인.
 * WebCodecs 미지원 브라우저에서는 조용히 무시한다 (서버의 스크린샷 폴백이 커버).
 */
export function useVideoStreams(
  onFrame: DecodedFrameSink,
  onStreamError?: (engine: EngineName) => void,
) {
  const pipelinesRef = useRef(new Map<EngineName, EngineVideoPipeline>());
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;
  const onStreamErrorRef = useRef(onStreamError);
  onStreamErrorRef.current = onStreamError;

  const resetPipeline = useCallback((engine: EngineName) => {
    const pipeline = pipelinesRef.current.get(engine);
    if (pipeline?.decoder && pipeline.decoder.state !== 'closed') pipeline.decoder.close();
    pipelinesRef.current.delete(engine);
  }, []);

  const decodeUnit = useCallback(
    (engine: EngineName, pipeline: EngineVideoPipeline, unit: H264AccessUnit) => {
      if (!pipeline.configured) {
        if (!pipeline.parser.codec) return; // SPS 전 — 설정 불가
        const decoder = new VideoDecoder({
          // createImageBitmap 변환 왕복을 생략하고 VideoFrame을 곧장 canvas로
          output: (frame) => onFrameRef.current(engine, frame),
          // 스트림 오류 — 파이프라인 리셋 + 서버에 재시작 요청(새 SPS/IDR).
          // scrcpy/idb는 주기 키프레임이 없어 요청 없이는 잔상이 지속된다
          error: () => {
            resetPipeline(engine);
            onStreamErrorRef.current?.(engine);
          },
        });
        decoder.configure({ codec: pipeline.parser.codec, optimizeForLatency: true });
        pipeline.decoder = decoder;
        pipeline.configured = true;
      }
      if (!pipeline.sawKeyframe) {
        if (!unit.isKeyframe) return; // 키프레임 전의 델타는 디코드 불가
        pipeline.sawKeyframe = true;
      }
      pipeline.timestamp += FRAME_DURATION_US;
      pipeline.decoder?.decode(
        new EncodedVideoChunk({
          type: unit.isKeyframe ? 'key' : 'delta',
          timestamp: pipeline.timestamp,
          data: unit.data,
        }),
      );
    },
    [resetPipeline],
  );

  const pushVideoChunk = useCallback(
    (engine: EngineName, bytes: Uint8Array) => {
      if (typeof VideoDecoder === 'undefined') return;
      let pipeline = pipelinesRef.current.get(engine);
      if (!pipeline) {
        pipeline = {
          parser: new H264AnnexBParser(),
          decoder: null,
          configured: false,
          sawKeyframe: false,
          timestamp: 0,
        };
        pipelinesRef.current.set(engine, pipeline);
      }
      const active = pipeline;

      // 트레일링 플러시 금지 — scrcpy(TCP)도 청크 경계가 NAL 경계가 아니라서
      // 잘린 NAL이 디코더 델타를 오염시킨다 (사용자 실검증에서 블록 깨짐 확인)
      for (const unit of active.parser.push(bytes)) decodeUnit(engine, active, unit);
    },
    [decodeUnit],
  );

  useEffect(() => {
    const pipelines = pipelinesRef.current;
    return () => {
      for (const pipeline of pipelines.values()) {
        if (pipeline.decoder && pipeline.decoder.state !== 'closed') pipeline.decoder.close();
      }
      pipelines.clear();
    };
  }, []);

  return { pushVideoChunk, resetPipeline };
}
