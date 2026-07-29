import type { SessionCapture, SessionEvent, SessionMeta } from '@crosspane/protocol';
import { RingBuffer } from './buffer.js';
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
  /** capture()를 .crosspane.json 파일로 다운로드 (웹뷰에서는 공유 시트 연동 등 앱 측 처리) */
  exportFile(): void;
  /** 훅 해제 + 라이브 연결 종료 (원본 console/fetch 복원) */
  dispose(): void;
}

const DISABLED_AGENT: CrosspaneAgent = {
  enabled: false,
  session: { id: '', label: '', userAgent: '', startedAt: 0 },
  capture() {
    return {
      version: 1,
      session: this.session,
      events: [],
      exportedAt: Date.now(),
    };
  },
  exportFile() {},
  dispose() {},
};

function detectPlatform(userAgent: string): string {
  if (/; wv\)/.test(userAgent)) return 'android-webview';
  if (/iPhone|iPad/.test(userAgent) && !/Safari\//.test(userAgent)) return 'ios-webview';
  if (/KAKAOTALK|Instagram|FBAV|Line\//i.test(userAgent)) return 'in-app-browser';
  return 'browser';
}

/**
 * crosspane 에이전트 초기화 — 앱 부트스트랩에서 가능한 한 일찍 호출할 것
 * (호출 이전의 콘솔/에러는 잡지 못한다).
 */
/**
 * 활성 에이전트 — 중복 초기화 방지용.
 * 두 번 init하면 console/fetch가 이중 후킹돼 이벤트가 중복 발생하고, dispose가
 * 한 겹만 복원해 원본이 영영 돌아오지 않는다 (HMR·중복 번들에서 실제로 발생한다).
 */
let activeAgent: CrosspaneAgent | null = null;

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
        version: 1,
        session,
        events: buffer.snapshot(),
        exportedAt: Date.now(),
      };
    },
    exportFile(): void {
      const blob = new Blob([JSON.stringify(this.capture(), null, 2)], {
        type: 'application/json',
      });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${session.label.replace(/[^\w-]+/g, '_')}-${session.id}.crosspane.json`;
      link.click();
      URL.revokeObjectURL(link.href);
    },
    dispose(): void {
      for (const teardown of teardowns) teardown();
      transport?.dispose();
      activeAgent = null;
    },
  };

  activeAgent = agent;
  return agent;
}
