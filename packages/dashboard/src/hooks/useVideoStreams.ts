import { useCallback, useEffect, useRef } from 'react';
import { type H264AccessUnit, H264AnnexBParser } from '../h264';
import type { EngineName } from '../types';

/** 디코딩된 비디오 프레임을 기존 프레임 구독 경로로 넘긴다 */
export type DecodedFrameSink = (engine: EngineName, frame: ImageBitmap) => void;

const FRAME_DURATION_US = 33_333; // 타임스탬프 용도 (30fps 가정, 표시 타이밍엔 미사용)
// 스트림이 이 시간 조용하면 pending의 마지막 프레임을 플러시 (다음 시작코드 대기 지연 제거)
const IDLE_FLUSH_MS = 25;

interface EngineVideoPipeline {
  parser: H264AnnexBParser;
  decoder: VideoDecoder | null;
  configured: boolean;
  sawKeyframe: boolean;
  timestamp: number;
  flushTimer: number | null;
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
    if (pipeline?.flushTimer !== null && pipeline?.flushTimer !== undefined) {
      window.clearTimeout(pipeline.flushTimer);
    }
    if (pipeline?.decoder && pipeline.decoder.state !== 'closed') pipeline.decoder.close();
    pipelinesRef.current.delete(engine);
  }, []);

  const decodeUnit = useCallback(
    (engine: EngineName, pipeline: EngineVideoPipeline, unit: H264AccessUnit) => {
      if (!pipeline.configured) {
        if (!pipeline.parser.codec) return; // SPS 전 — 설정 불가
        const decoder = new VideoDecoder({
          output: (frame) => {
            void createImageBitmap(frame).then((bitmap) => {
              frame.close();
              onFrameRef.current(engine, bitmap);
            });
          },
          // 스트림 오류(잘린 NAL 플러시 등) — 파이프라인을 버리고 다음 키프레임부터 재시작
          error: () => resetPipeline(engine),
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
          flushTimer: null,
        };
        pipelinesRef.current.set(engine, pipeline);
      }
      const active = pipeline;

      // 트레일링 플러시는 청크 경계 == NAL 경계가 보장되는 소스(scrcpy)에만.
      // idb는 파이프 경계가 임의라 잘린 NAL이 디코더를 죽인다 (IDR 재전송 없음 → 영구 정지 실측)
      if (engine === 'android') {
        if (active.flushTimer !== null) window.clearTimeout(active.flushTimer);
        active.flushTimer = window.setTimeout(() => {
          active.flushTimer = null;
          for (const unit of active.parser.flushPending()) decodeUnit(engine, active, unit);
        }, IDLE_FLUSH_MS);
      }

      for (const unit of active.parser.push(bytes)) decodeUnit(engine, active, unit);
    },
    [decodeUnit],
  );

  useEffect(() => {
    const pipelines = pipelinesRef.current;
    return () => {
      for (const pipeline of pipelines.values()) {
        if (pipeline.flushTimer !== null) window.clearTimeout(pipeline.flushTimer);
        if (pipeline.decoder && pipeline.decoder.state !== 'closed') pipeline.decoder.close();
      }
      pipelines.clear();
    };
  }, []);

  return { pushVideoChunk, resetPipeline };
}
