import type { SessionEvent } from '@crosspane/protocol';

/**
 * 연속 중복 이벤트를 합친 새 이벤트를 돌려준다 (합칠 수 없으면 null).
 *
 * 깨진 웹뷰가 같은 에러를 폭주시키면 링버퍼가 그 한 줄로 가득 차고 원인 이벤트가
 * 밀려난다 — 실측: 같은 메시지 3000줄 뒤 히스토리 2000건의 distinct가 1건이었고
 * 원인 에러는 사라졌다. 캡처 파일이 잠금 환경의 주력 경로라 치명적이다.
 *
 * network·navigation·screen은 합치지 않는다 — 각각이 개별 사실이고, 같은 URL을
 * 두 번 요청한 것은 한 번 요청한 것과 다르다.
 */
export function mergeRepeat(
  last: SessionEvent | undefined,
  next: SessionEvent,
): SessionEvent | null {
  if (!last || last.type !== next.type) return null;
  if (last.type === 'console' && next.type === 'console') {
    if (last.level !== next.level || last.text !== next.text) return null;
  } else if (last.type === 'pageerror' && next.type === 'pageerror') {
    if (last.message !== next.message || last.stack !== next.stack) return null;
  } else {
    return null;
  }
  // ts는 첫 발생 시각을 유지한다 — 타임라인 위치가 흔들리면 원인 추적이 어긋난다
  return { ...last, repeat: (last.repeat ?? 1) + (next.repeat ?? 1) };
}
