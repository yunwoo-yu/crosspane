import type { ClientCommand } from '../types';

/** 그대로 엔진에 전달할 특수 키 (나머지 문자는 input/composition 경유 type 커맨드) */
const FORWARDED_SPECIAL_KEYS = new Set([
  'Enter',
  'Backspace',
  'Delete',
  'Tab',
  'Escape',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

/**
 * 키보드/IME 미러링 — 숨김 input에 붙일 핸들러.
 * 브라우저 IME가 조합(한글 등)을 처리하고, 확정된 텍스트만 type 커맨드로 보낸다.
 */
export function useKeyboardMirroring(options: { sendCommand: (command: ClientCommand) => void }) {
  const { sendCommand } = options;
  return {
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
      // OS/브라우저 단축키(cmd+r 등)는 대시보드에 남긴다
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // IME 조합 중의 키 이벤트(key === 'Process' 등)는 조합 완료가 처리한다
      if (event.nativeEvent.isComposing) return;
      if (FORWARDED_SPECIAL_KEYS.has(event.key)) {
        event.preventDefault();
        sendCommand({ type: 'keypress', key: event.key });
      }
    },
    onInput: (event: React.FormEvent<HTMLInputElement>) => {
      const native = event.nativeEvent as InputEvent;
      // 조합 중간 상태와 조합 유래 input(Safari는 compositionend 후에도 발생)은
      // compositionend 핸들러가 담당한다 — 여기서 보내면 중복 전송된다
      if (native.isComposing || native.inputType?.startsWith('insertComposition')) return;
      if (native.inputType === 'insertFromComposition') return;
      if (native.data) sendCommand({ type: 'type', text: native.data });
      event.currentTarget.value = '';
    },
    onCompositionEnd: (event: React.CompositionEvent<HTMLInputElement>) => {
      // 한글 등 조합형 입력 — 조합이 확정된 음절만 전송
      if (event.data) sendCommand({ type: 'type', text: event.data });
      event.currentTarget.value = '';
    },
  };
}
