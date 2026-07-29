import {
  CAPTURE_FILE_EXTENSION,
  CAPTURE_FILE_VERSION,
  type SessionCapture,
  type SessionEvent,
  type SessionMeta,
} from '@crosspane/protocol';
import { RingBuffer } from './buffer.js';
import { copyText } from './clipboard.js';
import { installHooks } from './hooks.js';
import { LiveTransport } from './transport.js';

export type { SessionCapture, SessionEvent, SessionMeta };

export interface CrosspaneAgentOptions {
  /** 대시보드에 표시될 이름 (예: "결제 웹뷰 · QA build") */
  label?: string;
  /**
   * 게이팅 — false면 init이 아무것도 설치하지 않는다.
   * 스토어 빌드에서는 이 값으로 끄는 것보다, init 호출 자체를 빌드 플래그로
   * 제거(데드코드 엘리미네이션)하는 것을 권장한다 (README 참조).
   */
  enabled?: boolean | (() => boolean);
  /** 라이브 모드: crosspane 허브 주소 (예: "http://192.168.0.10:7788"). 없으면 오프라인 전용 */
  serverUrl?: string;
  /** 링버퍼 상한 (기본 2000 이벤트) */
  bufferSize?: number;
  /** 네트워크 응답 바디 수집 — 기본 꺼짐 (프라이버시 안전 기본값) */
  captureBodies?: boolean;
  bodyPreviewLimit?: number;
  /**
   * 콘솔/에러 텍스트 1건의 최대 길이 (기본 10000자).
   * 거대한 객체를 로그하는 페이지가 링버퍼와 회선을 잠식하는 것을 막는다.
   */
  maxTextLength?: number;
}

export interface CrosspaneAgent {
  readonly enabled: boolean;
  readonly session: SessionMeta;
  /** 링버퍼 스냅샷을 리플레이 파일 객체로 (대시보드에 드롭하면 재생) */
  capture(): SessionCapture;
  /**
   * capture()를 .crosspane.json 파일로 다운로드.
   *
   * 앱이 다운로드를 구현하지 않은 웹뷰에서는 조용히 실패한다(성공 여부를 알 방법이
   * 없다). 그런 환경에서는 `copyCapture()`를 쓰거나, `capture()`를 네이티브
   * 브리지로 넘길 것 — README의 "Getting captures off a locked device" 참조.
   */
  exportFile(): void;
  /**
   * capture()를 JSON 텍스트로 클립보드에 넣는다. QA가 채팅으로 붙여 넣는 경로 —
   * 다운로드가 막힌 기기에서 로그를 꺼낼 수 있는 유일한 무설정 수단이다.
   *
   * 성공 여부를 돌려준다. 조용히 실패하면 QA가 버그 대신 툴을 의심하게 되므로
   * 호출부에서 반드시 결과를 사용자에게 보일 것.
   */
  copyCapture(): Promise<boolean>;
  /**
   * 플러그인이 세션 타임라인에 이벤트를 싣는 확장 지점.
   * 링버퍼와 라이브 전송을 코어와 공유하므로 연결·세션이 하나로 유지된다
   * (플러그인이 자체 전송을 만들면 타임라인이 갈라진다).
   */
  emit(event: SessionEvent): void;
  /** 훅 해제 + 라이브 연결 종료 (원본 console/fetch 복원) */
  dispose(): void;
}

const DISABLED_AGENT: CrosspaneAgent = {
  enabled: false,
  session: { id: '', label: '', userAgent: '', startedAt: 0 },
  capture() {
    return {
      version: CAPTURE_FILE_VERSION,
      session: this.session,
      events: [],
      exportedAt: Date.now(),
    };
  },
  exportFile() {},
  copyCapture() {
    return Promise.resolve(false);
  },
  emit() {},
  dispose() {},
};

/**
 * 라벨 → 파일명 어간. `\w`로 정제하면 한국어 라벨('결제 웹뷰')이 통째로 `_`가 되어
 * 파일명이 무의미해진다 — 이 툴의 사용자층에 직접 영향이 있으므로 스크립트 무관하게
 * 문자·숫자를 남긴다. (허브의 `GET /capture/:id`도 같은 규칙을 쓴다 — 두 경로가
 * 같은 이름을 만들어야 한다)
 */
function captureFileStem(label: string): string {
  const cleaned = label
    .replace(/[^\p{L}\p{N}_-]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return cleaned === '' ? 'session' : cleaned;
}

function detectPlatform(userAgent: string): string {
  if (/; wv\)/.test(userAgent)) return 'android-webview';
  if (/iPhone|iPad/.test(userAgent) && !/Safari\//.test(userAgent)) return 'ios-webview';
  if (/KAKAOTALK|Instagram|FBAV|Line\//i.test(userAgent)) return 'in-app-browser';
  return 'browser';
}

/**
 * 활성 에이전트 — 중복 초기화 방지용.
 * 두 번 init하면 console/fetch가 이중 후킹돼 이벤트가 중복 발생하고, dispose가
 * 한 겹만 복원해 원본이 영영 돌아오지 않는다 (HMR·중복 번들에서 실제로 발생한다).
 */
let activeAgent: CrosspaneAgent | null = null;

/**
 * crosspane 에이전트 초기화 — 앱 부트스트랩에서 가능한 한 일찍 호출할 것
 * (호출 이전의 콘솔/에러는 잡지 못한다).
 */
export function initCrosspane(options: CrosspaneAgentOptions = {}): CrosspaneAgent {
  const enabled =
    typeof options.enabled === 'function' ? options.enabled() : (options.enabled ?? true);
  if (!enabled || typeof window === 'undefined') return DISABLED_AGENT;
  if (activeAgent) return activeAgent;

  const session: SessionMeta = {
    id: `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    label: options.label ?? document.title ?? 'session',
    userAgent: navigator.userAgent,
    url: location.href,
    platform: detectPlatform(navigator.userAgent),
    startedAt: Date.now(),
  };

  const buffer = new RingBuffer(options.bufferSize ?? 2_000);
  const transport = options.serverUrl ? new LiveTransport(options.serverUrl, session) : null;
  transport?.connect();

  const emit = (event: SessionEvent): void => {
    buffer.push(event);
    transport?.enqueue(event);
  };

  const teardowns = installHooks({
    sessionId: session.id,
    emit,
    captureBodies: options.captureBodies ?? false,
    bodyPreviewLimit: options.bodyPreviewLimit ?? 2_048,
    maxTextLength: options.maxTextLength ?? 10_000,
  });

  // 페이지 진입도 하나의 내비게이션으로 기록 — 리플레이의 시작점이 된다
  emit({ type: 'navigation', sessionId: session.id, url: location.href, ts: Date.now() });

  const agent: CrosspaneAgent = {
    enabled: true,
    session,
    capture(): SessionCapture {
      return {
        version: CAPTURE_FILE_VERSION,
        session,
        events: buffer.snapshot(),
        // 링버퍼가 버린 수를 함께 싣는다 — 조용히 앞부분이 잘린 파일은 오도한다
        droppedEvents: buffer.droppedCount,
        exportedAt: Date.now(),
      };
    },
    exportFile(): void {
      const blob = new Blob([JSON.stringify(this.capture(), null, 2)], {
        type: 'application/json',
      });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${captureFileStem(session.label)}-${session.id}${CAPTURE_FILE_EXTENSION}`;
      link.click();
      URL.revokeObjectURL(link.href);
    },
    copyCapture(): Promise<boolean> {
      return copyText(JSON.stringify(this.capture(), null, 2));
    },
    emit,
    dispose(): void {
      for (const teardown of teardowns) teardown();
      transport?.dispose();
      activeAgent = null;
    },
  };

  activeAgent = agent;
  return agent;
}
