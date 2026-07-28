import { useCallback, useEffect, useRef, useState } from 'react';
import { RECONNECT_DELAY_MS } from '../constants';
import { logEntryFromEvent, reduceEngineStates } from '../event-log';
import { routeBinaryPacket } from '../frame-router';
import {
  type ClientCommand,
  ENGINE_NAMES_BY_CODE,
  type EngineName,
  type EngineState,
  type FrameListener,
  type HelloEvent,
  type LogEntry,
  type NetworkEntry,
  SCROLL_Y_UNKNOWN,
  type ServerEvent,
} from '../types';
import { useEventBatcher } from './useEventBatcher';
import { useFrameHub } from './useFrameHub';
import { useVideoStreams } from './useVideoStreams';

export interface CrosspaneConnection {
  connected: boolean;
  hello: HelloEvent | null;
  engineStates: Partial<Record<EngineName, EngineState>>;
  logs: LogEntry[];
  networkEntries: NetworkEntry[];
  sendCommand: (command: ClientCommand) => void;
  clearLogs: () => void;
  /**
   * 엔진의 프레임 스트림을 구독한다. 프레임은 React 상태를 거치지 않고
   * 구독자(canvas)에 직접 전달된다 — 고프레임에서 리렌더 비용을 없애기 위함.
   * 반환값은 구독 해제 함수. 전달된 ImageBitmap은 콜백 밖으로 유출하면 안 된다(호출 후 close됨).
   */
  subscribeToFrames: (engine: EngineName, listener: FrameListener) => () => void;
}

/**
 * WS 연결 수명주기 + 조립부. 실제 로직은 책임별 모듈에 있다:
 * - 이벤트→상태 전이 규칙: event-log.ts (순수 함수)
 * - 로그/네트워크 배칭: useEventBatcher
 * - 프레임 구독/디스패치: useFrameHub / 바이너리 패킷 파싱: frame-router.ts
 * - H.264 디코드: useVideoStreams
 */
export function useCrosspaneSocket(): CrosspaneConnection {
  const socketRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [hello, setHello] = useState<HelloEvent | null>(null);
  const [engineStates, setEngineStates] = useState<Partial<Record<EngineName, EngineState>>>({});

  const sendCommand = useCallback((command: ClientCommand) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(command));
  }, []);

  const batcher = useEventBatcher();
  const frameHub = useFrameHub(sendCommand);

  // 실시간 비디오 스트림(H.264) — 디코드 결과는 스냅샷 프레임과 같은 경로로 흐른다.
  // 디코더 오류 시 서버에 재시작을 요청해 키프레임부터 자가 회복 (잔상 방지)
  const lastRestartRef = useRef(0);
  const { pushVideoChunk, resetPipeline } = useVideoStreams(
    (engine, frame) => frameHub.dispatchFrame(engine, frame, SCROLL_Y_UNKNOWN),
    (engine) => {
      const now = Date.now();
      if (now - lastRestartRef.current < 1_500) return;
      lastRestartRef.current = now;
      sendCommand({ type: 'restart-video', engine });
    },
  );

  const { appendLog, appendNetwork, clear: clearBatched } = batcher;
  const handleServerEvent = useCallback(
    (event: ServerEvent) => {
      if (event.type === 'hello') {
        setHello(event);
        // hello는 접속당 1회의 세션 경계다 — 서버가 접속마다 히스토리를 전량
        // 재생하므로, 이전 세션 분을 비우지 않으면 재접속마다 로그가 중복 누적된다
        clearBatched();
      }
      if (event.type === 'engine-status' && event.status === 'stopped') resetPipeline(event.engine);
      setEngineStates((prev) => reduceEngineStates(prev, event));
      if (event.type === 'network') appendNetwork(event);
      else {
        const entry = logEntryFromEvent(event);
        if (entry) appendLog(entry);
      }
    },
    [appendLog, appendNetwork, clearBatched, resetPipeline],
  );

  const { hasSubscribers, dispatchFrame, sendWatchedEngines } = frameHub;
  const handleBinaryPacket = useCallback(
    (packet: ArrayBuffer) =>
      routeBinaryPacket(packet, { hasSubscribers, dispatchFrame, pushVideoChunk }),
    [hasSubscribers, dispatchFrame, pushVideoChunk],
  );

  useEffect(() => {
    let disposed = false;
    let retryTimer: number | null = null;

    const connect = (): void => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const socket = new WebSocket(`${proto}://${location.host}/ws`);
      socket.binaryType = 'arraybuffer';
      socketRef.current = socket;
      socket.onopen = () => {
        setConnected(true);
        // 재접속 시 현재 시청 목록을 다시 알린다 (서버는 미전송 클라이언트를 전체 시청으로 간주)
        sendWatchedEngines();
      };
      // CLI 재시작 등으로 끊기면 자동 재접속한다.
      // 좀비 소켓 가드: 이전 소켓의 늦은 close/message가 새 소켓의 상태를
      // 덮어쓰지 않게 한다 (StrictMode 재마운트·재접속 레이스에서 실제 발생)
      socket.onclose = () => {
        if (socketRef.current !== socket) return;
        setConnected(false);
        // 재접속하면 서버가 비디오 스트림을 재시작(새 SPS/IDR)한다 — 이전 세션의
        // 미완 NAL과 sawKeyframe을 리셋하지 않으면 새 스트림 첫 유닛이 오염된다
        for (const engine of ENGINE_NAMES_BY_CODE) resetPipeline(engine);
        if (!disposed) retryTimer = window.setTimeout(connect, RECONNECT_DELAY_MS);
      };
      socket.onmessage = (ev: MessageEvent<string | ArrayBuffer>) => {
        if (socketRef.current !== socket) return;
        if (typeof ev.data === 'string') {
          handleServerEvent(JSON.parse(ev.data) as ServerEvent);
        } else {
          handleBinaryPacket(ev.data);
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      socketRef.current?.close();
    };
  }, [handleServerEvent, handleBinaryPacket, sendWatchedEngines, resetPipeline]);

  return {
    connected,
    hello,
    engineStates,
    logs: batcher.logs,
    networkEntries: batcher.networkEntries,
    sendCommand,
    clearLogs: batcher.clear,
    subscribeToFrames: frameHub.subscribeToFrames,
  };
}
