import { useEffect, useState } from 'react';
import { withHubToken } from '../hub-token';
import { Button } from './ui/button';

interface HubInfo {
  port: number;
  exposed: boolean;
  serverUrls: string[];
}

/**
 * "에이전트를 여기로 붙여라" — 붙여넣을 수 있는 형태로 화면에 띄운다.
 *
 * 허브만 자기 포트와 LAN 주소를 아는데 사용자는 대시보드를 보고 있다. 터미널에만
 * 찍으면 놓치고, serverUrl을 잘못 적어 "빈 대시보드"를 마주한다(실측 — 포트 폴백으로
 * 허브가 7790에 떴는데 앱은 7788을 가리켜 세션이 사라진 적이 있다).
 */
export function ConnectHint() {
  const [info, setInfo] = useState<HubInfo | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(withHubToken('/hub-info'))
      .then((response) => (response.ok ? response.json() : null))
      .then((value: HubInfo | null) => {
        if (active) setInfo(value);
      })
      // 리플레이만 쓰는 경우 허브가 없을 수 있다 — 조용히 넘어간다
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (!info) return null;
  const serverUrl = info.serverUrls[0];
  const snippet = `import { initCrosspane } from '@crosspane/agent'\n\ninitCrosspane({\n  label: 'my webview',\n  serverUrl: '${serverUrl}',\n})`;

  return (
    <div className="w-full max-w-xl text-left">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-fg-muted text-xs">Point your app at this hub</span>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto"
          onClick={() => {
            void copyText(snippet).then(setCopied);
          }}
        >
          {copied ? 'copied' : 'copy'}
        </Button>
      </div>
      <pre className="overflow-x-auto rounded border border-line bg-panel p-3 text-[11px] leading-relaxed">
        {snippet}
      </pre>
      {info.exposed ? (
        info.serverUrls.length > 1 && (
          <p className="mt-1 text-fg-muted text-[11px]">
            Other addresses on this machine: {info.serverUrls.slice(1).join(', ')}
          </p>
        )
      ) : (
        <p className="mt-1 text-fg-muted text-[11px]">
          Local only — restart with <code className="text-fg">--host 0.0.0.0</code> (or{' '}
          <code className="text-fg">pnpm try:lan</code>) to accept sessions from a phone on your
          network.
        </p>
      )}
    </div>
  );
}

/**
 * 클립보드 복사. **`packages/agent/src/clipboard.ts`와 의도적 중복이다** —
 * 대시보드가 SDK를 의존하면 안 되고(의존 방향), 프로토콜에는 런타임 코드를 둘 수 없다.
 * 한쪽을 고치면 다른 쪽도 보라. 에이전트 쪽에는 포커스 복원이 더 있다(입력 중인
 * 사용자를 방해하지 않기 위해). 여기는 빈 상태 화면이라 그 위험이 없다.
 *
 * execCommand 폴백이 필요한 이유는 양쪽이 같다:
 * 대시보드를 `http://<사내 IP>`로 열면 보안 컨텍스트가 아니라 `navigator.clipboard`가 없다.
 * 에이전트에서 import하지 않는 이유는 의존 방향이다 — 대시보드가 SDK를 의존하면 안 된다.
 */
async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 권한 거부 — 아래로 내려간다
    }
  }
  if (typeof document.execCommand !== 'function') return false;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('aria-hidden', 'true');
  area.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
  document.body.appendChild(area);
  try {
    area.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
