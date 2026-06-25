import { useTranslation } from 'react-i18next';
import { Coffee } from 'lucide-react';
import { PageShell } from '@/components/layout/PageShell';
import { Button } from '@/components/ui/button';
import { KOFI_URL } from '@/lib/constants';

export function SupportPage() {
  const { t } = useTranslation();

  return (
    <PageShell variant="narrow">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold text-rizzotto-gold-500">
          {t('support.title')}
        </h1>
      </header>

      <div className="max-w-2xl space-y-8">
        <p className="text-rizzotto-stone-300 leading-relaxed">{t('support.intro')}</p>

        <div>
          <Button asChild variant="forge" size="lg">
            <a href={KOFI_URL} target="_blank" rel="noopener noreferrer">
              <Coffee className="size-5" strokeWidth={1.5} aria-hidden="true" />
              {t('support.cta')}
            </a>
          </Button>
        </div>

        <p className="text-sm text-rizzotto-stone-500">{t('support.note')}</p>

        <p className="font-display italic tracking-wider text-rizzotto-stone-500">
          {t('support.motto')}
        </p>
      </div>
    </PageShell>
  );
}
