import type { CrosspaneAgent } from '@crosspane/agent';
import { record } from 'rrweb';

/**
 * 화면 기록 플러그인 — rrweb의 DOM 스트림을 코어 에이전트의 타임라인에 싣는다.
 *
 * 왜 별도 패키지인가: rrweb은 gzip 기준으로도 코어 에이전트(~2.5KB)보다 수십 배
 * 크다. 코어의 "의존성 0 / 수 KB" 계약을 지키면서 화면이 필요한 사람만
 * 추가로 설치하게 하는 것이 유일하게 정직한 구성이다.
 */

export interface ScreenRecordingOptions {
  /**
   * 전체 스냅샷 재촬영 간격(ms, 기본 20초). rrweb은 최초 스냅샷 + 이후 diff라
   * 중간부터 재생하려면 주기적 스냅샷이 필요하다. 짧을수록 되감기가 정확하지만
   * 이벤트량이 는다.
   */
  checkoutEveryNms?: number;
  /**
   * 입력값 마스킹 (기본 켜짐). DOM 기록은 본질적으로 화면의 모든 텍스트를
   * 수집하므로, 끄는 것은 명시적 선택이어야 한다.
   */
  maskAllInputs?: boolean;
  /** 이 셀렉터에 걸리는 요소는 기록에서 가린다 (예: '.sensitive') */
  blockSelector?: string;
  /** 텍스트를 가릴 셀렉터 */
  maskTextSelector?: string;
}

export interface ScreenRecording {
  /** 기록 중지 — rrweb 리스너 해제 */
  stop(): void;
}

/** 이 플러그인이 싣는 화면 이벤트의 format 값 — 대시보드가 플레이어를 고르는 키 */
export const SCREEN_FORMAT = 'rrweb';

/**
 * 화면 기록을 시작한다. 에이전트가 비활성(게이팅 off)이면 아무것도 하지 않는다 —
 * 코어와 같은 게이팅 계약을 따라야 스토어 빌드에서 조용히 켜지는 일이 없다.
 */
export function startScreenRecording(
  agent: CrosspaneAgent,
  options: ScreenRecordingOptions = {},
): ScreenRecording {
  if (!agent.enabled) return { stop() {} };

  const stopFn = record({
    emit(event) {
      agent.emit({
        type: 'screen',
        sessionId: agent.session.id,
        format: SCREEN_FORMAT,
        data: event,
        ts: Date.now(),
      });
    },
    checkoutEveryNms: options.checkoutEveryNms ?? 20_000,
    maskAllInputs: options.maskAllInputs ?? true,
    blockSelector: options.blockSelector,
    maskTextSelector: options.maskTextSelector,
  });

  return {
    stop() {
      // rrweb의 record()는 기록을 못 시작하면 undefined를 돌려준다
      stopFn?.();
    },
  };
}
