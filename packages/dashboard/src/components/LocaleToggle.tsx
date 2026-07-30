import { useLocale } from '../hooks/useLocale';
import { Button } from './ui/button';

/**
 * 언어 전환. 두 개뿐이라 드롭다운 대신 토글 두 개다 — 현재 언어가 한눈에 보이고
 * 한 번 눌러 바뀐다. 선택은 저장되므로 다음에 열 때 유지된다.
 */
export function LocaleToggle() {
  const { locale, setLocale, t } = useLocale();

  return (
    <div className="flex items-center gap-0.5" title={t.language}>
      {(['ko', 'en'] as const).map((code) => (
        <Button
          key={code}
          variant={locale === code ? 'active' : 'ghost'}
          size="icon"
          className="px-1.5 text-[11px] uppercase"
          aria-pressed={locale === code}
          onClick={() => setLocale(code)}
        >
          {code}
        </Button>
      ))}
    </div>
  );
}
