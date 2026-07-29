import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from '../src/clipboard.js';

/**
 * jsdom에는 `navigator.clipboard`도 `document.execCommand`도 없다 — 둘 다 스텁한다.
 * 그 부재 자체가 이 모듈이 존재하는 이유이기도 하다 (잠금 환경 = 비보안 컨텍스트).
 */

type ExecCommandStub = ((command: string) => boolean) | undefined;

function stubExecCommand(impl: ExecCommandStub): void {
  Object.defineProperty(document, 'execCommand', {
    value: impl,
    configurable: true,
    writable: true,
  });
}

function stubClipboard(writeText: ((text: string) => Promise<void>) | undefined): void {
  Object.defineProperty(navigator, 'clipboard', {
    value: writeText ? { writeText } : undefined,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  stubClipboard(undefined);
  stubExecCommand(undefined);
  vi.restoreAllMocks();
});

describe('copyText', () => {
  it('보안 컨텍스트에서는 navigator.clipboard를 쓴다', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    expect(await copyText('payload')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('payload');
  });

  it('clipboard가 없으면 execCommand로 내려간다 — http://<사내 IP>의 실제 경로', async () => {
    // 비보안 컨텍스트에서는 navigator.clipboard가 정의조차 되지 않는다 (실측)
    stubClipboard(undefined);
    const exec = vi.fn().mockReturnValue(true);
    stubExecCommand(exec);

    expect(await copyText('payload')).toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
  });

  it('clipboard가 거부하면(제스처·권한) execCommand로 내려간다', async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error('NotAllowedError')));
    const exec = vi.fn().mockReturnValue(true);
    stubExecCommand(exec);

    expect(await copyText('payload')).toBe(true);
    expect(exec).toHaveBeenCalled();
  });

  it('둘 다 없으면 false — 조용히 성공한 척하지 않는다', async () => {
    stubClipboard(undefined);
    stubExecCommand(undefined);
    expect(await copyText('payload')).toBe(false);
  });

  it('execCommand가 실패를 반환하면 false', async () => {
    stubClipboard(undefined);
    stubExecCommand(vi.fn().mockReturnValue(false));
    expect(await copyText('payload')).toBe(false);
  });

  it('execCommand가 던져도 false로 흡수한다 — 페이지를 깨뜨리지 않는다', async () => {
    stubClipboard(undefined);
    stubExecCommand(() => {
      throw new Error('not implemented');
    });
    expect(await copyText('payload')).toBe(false);
  });

  describe('페이지 무영향', () => {
    it('임시 textarea를 남기지 않는다', async () => {
      stubClipboard(undefined);
      stubExecCommand(vi.fn().mockReturnValue(true));

      await copyText('payload');
      expect(document.querySelectorAll('textarea')).toHaveLength(0);
    });

    it('실패해도 textarea를 남기지 않는다', async () => {
      stubClipboard(undefined);
      stubExecCommand(() => {
        throw new Error('boom');
      });

      await copyText('payload');
      expect(document.querySelectorAll('textarea')).toHaveLength(0);
    });

    it('원래 포커스를 되돌린다 — 입력 중인 사용자를 방해하면 안 된다', async () => {
      stubClipboard(undefined);
      stubExecCommand(vi.fn().mockReturnValue(true));

      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();
      expect(document.activeElement).toBe(input);

      await copyText('payload');
      expect(document.activeElement).toBe(input);
      input.remove();
    });

    it('복사 대상 텍스트를 그대로 싣는다', async () => {
      stubClipboard(undefined);
      let copied: string | undefined;
      stubExecCommand(() => {
        copied = document.querySelector('textarea')?.value;
        return true;
      });

      await copyText('{"version":1}');
      expect(copied).toBe('{"version":1}');
    });
  });
});
