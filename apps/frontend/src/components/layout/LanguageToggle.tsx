import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

type Locale = 'de' | 'en';

export function LanguageToggle({ className }: { className?: string }) {
  const { i18n, t } = useTranslation();
  const current = (i18n.resolvedLanguage ?? i18n.language ?? 'de').slice(0, 2) as Locale;

  function switchTo(lng: Locale) {
    if (lng === current) return;
    void i18n.changeLanguage(lng);
  }

  return (
    <div
      role="group"
      aria-label={t('language.switch_aria')}
      className={cn(
        'inline-flex items-center gap-px rounded-sm border border-karaz-iron-600 bg-karaz-iron-900 p-px text-[11px] font-display font-semibold uppercase tracking-wider',
        className,
      )}
    >
      <button
        type="button"
        aria-pressed={current === 'de'}
        onClick={() => switchTo('de')}
        className={cn(
          'rounded-[2px] px-2 py-1 transition-colors',
          current === 'de'
            ? 'bg-karaz-gold-500/20 text-karaz-gold-400'
            : 'text-karaz-stone-400 hover:text-karaz-stone-200',
        )}
      >
        {t('language.de')}
      </button>
      <button
        type="button"
        aria-pressed={current === 'en'}
        onClick={() => switchTo('en')}
        className={cn(
          'rounded-[2px] px-2 py-1 transition-colors',
          current === 'en'
            ? 'bg-karaz-gold-500/20 text-karaz-gold-400'
            : 'text-karaz-stone-400 hover:text-karaz-stone-200',
        )}
      >
        {t('language.en')}
      </button>
    </div>
  );
}
