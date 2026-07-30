import { describe, expect, it } from 'vitest';
import { ConsolePanel } from '../src/components/ConsolePanel';
import { initialLocale, type Locale, messagesFor } from '../src/i18n';
import { render, screen } from './render';

const LOCALES: Locale[] = ['ko', 'en'];

describe('문구 사전', () => {
  it('두 언어의 키 집합이 정확히 같다 — 빠진 번역은 영어로 조용히 새면 안 된다', () => {
    const [ko, en] = LOCALES.map((locale) => Object.keys(messagesFor(locale)).sort());
    expect(ko).toEqual(en);
  });

  it('영어 문구가 한국어에 그대로 복사돼 있지 않다 (번역 누락 탐지)', () => {
    const en = messagesFor('en');
    const ko = messagesFor('ko');
    const untranslated = Object.keys(en).filter((key) => {
      const a = en[key as keyof typeof en];
      const b = ko[key as keyof typeof ko];
      return typeof a === 'string' && typeof b === 'string' && a === b;
    });
    // 고유명사·기술 용어는 같아도 된다 — 그 외가 같으면 번역을 빠뜨린 것이다
    expect(untranslated.sort()).toEqual(['appTitle', 'xhrFetchOnly']);
  });

  it('함수형 문구는 값을 실제로 끼워 넣는다', () => {
    for (const locale of LOCALES) {
      const t = messagesFor(locale);
      expect(t.olderHidden('12')).toContain('12');
      expect(t.repeatTitle(4, null)).toContain('4');
      expect(t.repeatTitle(4, '2m')).toContain('2m');
      expect(t.requestCount(3, null)).toContain('3');
      expect(t.requestCount(3, '900')).toContain('900');
      expect(t.replayingToast('세션', 3)).toContain('세션');
      expect(t.replayingToast('세션', 3)).toContain('3');
    }
  });
});

describe('초기 언어', () => {
  it('저장된 선택이 브라우저 설정을 이긴다', () => {
    localStorage.setItem('crosspane:locale', 'ko');
    try {
      expect(initialLocale()).toBe('ko');
    } finally {
      localStorage.clear();
    }
  });

  it('저장값이 없으면 브라우저 설정을 따른다', () => {
    localStorage.clear();
    expect(['ko', 'en']).toContain(initialLocale());
  });

  it('알 수 없는 저장값은 무시한다', () => {
    localStorage.setItem('crosspane:locale', 'fr');
    try {
      expect(['ko', 'en']).toContain(initialLocale());
    } finally {
      localStorage.clear();
    }
  });
});

describe('실제 렌더', () => {
  it('한국어로 렌더하면 한국어 문구가 나온다', () => {
    render(<ConsolePanel logs={[]} />, { locale: 'ko' });
    expect(screen.getByPlaceholderText(messagesFor('ko').filterLogs)).toBeTruthy();
  });

  it('영어로 렌더하면 영어 문구가 나온다', () => {
    render(<ConsolePanel logs={[]} />, { locale: 'en' });
    expect(screen.getByPlaceholderText(messagesFor('en').filterLogs)).toBeTruthy();
  });
});
