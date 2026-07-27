import { useCallback, useEffect, useRef } from 'react';
import { H264AnnexBParser } from '../h264';
import type { EngineName } from '../types';

/** 디코딩된 비디오 프레임을 기존 프레임 구독 경로로 넘긴다 */
export type DecodedFrameSink = (engine: EngineName, frame: ImageBitmap) => void;

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
export function useVideoStreams(onFrame: DecodedFrameSink) {
  const pipelinesRef = useRef(new Map<EngineName, EngineVideoPipeline>());
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  const resetPipeline = useCallback((engine: EngineName) => {
    const pipeline = pipelinesRef.current.get(engine);
    if (pipeline?.decoder && pipeline.decoder.state !== 'closed') pipeline.decoder.close();
    pipelinesRef.current.delete(engine);
  }, []);

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

      for (const unit of pipeline.parser.push(bytes)) {
        if (!pipeline.configured) {
          if (!pipeline.parser.codec) continue; // SPS 전 — 설정 불가
          const decoder = new VideoDecoder({
            output: (frame) => {
              void createImageBitmap(frame).then((bitmap) => {
                frame.close();
                onFrameRef.current(engine, bitmap);
              });
            },
            // 스트림 오류(중간 합류 등) — 파이프라인을 버리고 다음 키프레임부터 재시작
            error: () => resetPipeline(engine),
          });
          decoder.configure({ codec: pipeline.parser.codec, optimizeForLatency: true });
          pipeline.decoder = decoder;
          pipeline.configured = true;
        }
        if (!pipeline.sawKeyframe) {
          if (!unit.isKeyframe) continue; // 키프레임 전의 델타는 디코드 불가
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
      }
    },
    [resetPipeline],
  );

  useEffect(() => {
    const pipelines = pipelinesRef.current;
    return () => {
      for (const engine of [...pipelines.keys()]) {
        const pipeline = pipelines.get(engine);
        if (pipeline?.decoder && pipeline.decoder.state !== 'closed') pipeline.decoder.close();
      }
      pipelines.clear();
    };
  }, []);

  return { pushVideoChunk, resetPipeline };
}
