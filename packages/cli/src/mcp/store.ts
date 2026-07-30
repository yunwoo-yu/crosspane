import type { ServerEvent, SessionEvent, SessionMeta } from '@crosspane/protocol';

/**
 * MCP 서버가 들고 있는 세션 상태 — 허브 `/ws`에서 받은 것을 그대로 쌓는다.
 *
 * 허브와 상태를 공유하지 않는 이유: 허브는 접속한 대시보드 클라이언트에게
 * hello + 히스토리 전량을 재생한다. MCP 서버도 그냥 대시보드 클라이언트로
 * 붙으면 별도의 조회 API 없이 같은 데이터를 얻는다 (허브 수정 0).
 */

const DEFAULT_EVENT_LIMIT = 5_000;

export interface StoredSession {
  meta: SessionMeta;
  live: boolean;
  endedAt?: number;
  events: SessionEvent[];
  /** 상한을 넘어 버린 이벤트 수 — 답이 전량이 아님을 밝히기 위해 유지한다 */
  dropped: number;
}

export class SessionStore {
  private readonly sessions = new Map<string, StoredSession>();

  constructor(private readonly eventLimit: number = DEFAULT_EVENT_LIMIT) {}

  apply(event: ServerEvent): void {
    switch (event.type) {
      case 'hello': {
        // hello는 세션 경계다 — 허브가 재접속마다 히스토리를 전량 재생하므로
        // 비우지 않으면 이벤트가 중복 누적된다 (대시보드에서 실측된 버그와 같은 원인)
        this.sessions.clear();
        for (const meta of event.sessions) this.ensure(meta);
        return;
      }
      case 'session-joined': {
        const session = this.ensure(event.session);
        session.live = true;
        session.endedAt = undefined;
        return;
      }
      case 'session-left': {
        const session = this.sessions.get(event.sessionId);
        if (session) {
          session.live = false;
          session.endedAt = event.ts;
        }
        return;
      }
      // 재생 경계 신호 — 스토어가 담을 것이 없다 (index.ts가 첫 응답 시점에 쓴다)
      case 'history-complete':
        return;
      default: {
        // 등록되지 않은 세션의 이벤트는 버린다 — hello 이전에 도착한 잔여분
        const session = this.sessions.get(event.sessionId);
        if (!session) return;
        session.events.push(event);
        if (session.events.length > this.eventLimit) {
          session.events.shift();
          session.dropped += 1;
        }
      }
    }
  }

  list(): StoredSession[] {
    return [...this.sessions.values()].sort((a, b) => b.meta.startedAt - a.meta.startedAt);
  }

  /**
   * 세션 지시자 해석 — 코딩 에이전트는 id보다 라벨("결제 웹뷰")로 부르는 게 자연스럽고,
   * 세션이 하나뿐이면 아예 생략하는 게 자연스럽다. 둘 다 받아준다.
   */
  resolve(selector: string | undefined): StoredSession | undefined {
    const all = this.list();
    if (selector === undefined || selector === '') {
      return all.length === 1 ? all[0] : undefined;
    }
    const exact = this.sessions.get(selector);
    if (exact) return exact;
    const needle = selector.toLowerCase();
    return (
      all.find((session) => session.meta.label.toLowerCase() === needle) ??
      all.find((session) => session.meta.label.toLowerCase().includes(needle)) ??
      all.find((session) => session.meta.id.startsWith(selector))
    );
  }

  private ensure(meta: SessionMeta): StoredSession {
    const existing = this.sessions.get(meta.id);
    if (existing) {
      existing.meta = meta;
      return existing;
    }
    const created: StoredSession = { meta, live: true, events: [], dropped: 0 };
    this.sessions.set(meta.id, created);
    return created;
  }
}
