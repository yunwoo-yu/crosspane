import { describe, expect, it } from 'vitest';
import { applyInteractiveAnswers, detectMissingSetup } from '../src/interactive';

describe('detectMissingSetup', () => {
  it('아무것도 없으면 전부 물어본다', () => {
    expect(detectMissingSetup([])).toEqual({ target: true, profile: true, port: true });
  });

  it('명시된 항목은 묻지 않는다', () => {
    expect(detectMissingSetup([':3000', '--profile', 'web', '--port', '9000'])).toEqual({
      target: false,
      profile: false,
      port: false,
    });
  });

  it('타깃만 있으면 프로필/포트를 물어본다', () => {
    expect(detectMissingSetup([':3000'])).toEqual({ target: false, profile: true, port: true });
  });

  it('플래그로 시작하면 타깃이 없는 것으로 판단한다', () => {
    expect(detectMissingSetup(['--profile', 'web']).target).toBe(true);
  });
});

describe('applyInteractiveAnswers', () => {
  it('타깃은 맨 앞에, 플래그는 뒤에 합쳐 기존 파서를 재사용한다', () => {
    expect(
      applyInteractiveAnswers(['--engines', 'chromium'], {
        target: ':3000',
        profile: 'device',
        port: 8000,
      }),
    ).toEqual([':3000', '--engines', 'chromium', '--profile', 'device', '--port', '8000']);
  });

  it('답변이 없는 항목은 argv를 바꾸지 않는다', () => {
    expect(applyInteractiveAnswers([':3000'], {})).toEqual([':3000']);
  });
});
