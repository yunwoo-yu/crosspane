import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { initialLocale, type Locale, type Messages, messagesFor, storeLocale } from '../i18n';

interface LocaleValue {
  locale: Locale;
  /** 문구 사전 — 컴포넌트는 `t.someKey`로 읽는다 */
  t: Messages;
  setLocale: (next: Locale) => void;
}

/**
 * 언어를 컨텍스트로 내리는 이유: 패널들이 깊이 중첩돼 있어 prop으로 내리면 모든 중간
 * 컴포넌트가 쓰지도 않는 값을 통과시키게 된다. 값이 하나뿐이고 거의 안 바뀌므로
 * 컨텍스트 리렌더 비용도 문제가 되지 않는다.
 */
const LocaleContext = createContext<LocaleValue | null>(null);

export function LocaleProvider({
  children,
  initial,
}: {
  children: ReactNode;
  /** 초기 언어 고정 (테스트용) — 없으면 저장값·브라우저 설정을 따른다 */
  initial?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(() => initial ?? initialLocale());

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    storeLocale(next);
  }, []);

  const value = useMemo<LocaleValue>(
    () => ({ locale, t: messagesFor(locale), setLocale }),
    [locale, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/**
 * Provider 밖에서 부르면 던진다 — 조용히 영어로 떨어지면 번역 누락과 구분되지 않는다.
 */
export function useLocale(): LocaleValue {
  const value = useContext(LocaleContext);
  if (value === null) throw new Error('useLocale must be used inside <LocaleProvider>');
  return value;
}
