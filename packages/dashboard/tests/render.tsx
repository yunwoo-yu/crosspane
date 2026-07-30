import { render as baseRender, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { LocaleProvider } from '../src/hooks/useLocale';
import type { Locale } from '../src/i18n';

/**
 * 패널은 `LocaleProvider` 안에서만 동작한다 (밖에서 부르면 던진다 — 조용히 영어로
 * 떨어지면 번역 누락과 구분되지 않기 때문이다). 테스트도 같은 조건으로 렌더한다.
 *
 * 언어를 명시하는 이유: 기본값은 브라우저 설정을 보므로 실행 환경에 따라 바뀐다.
 * 단정이 언어에 의존하는 테스트가 환경 때문에 흔들리면 안 된다.
 */
export function render(
  ui: ReactElement,
  { locale = 'en' as Locale, ...options }: RenderOptions & { locale?: Locale } = {},
) {
  return baseRender(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <LocaleProvider initial={locale}>{children}</LocaleProvider>
    ),
    ...options,
  });
}

export * from '@testing-library/react';
