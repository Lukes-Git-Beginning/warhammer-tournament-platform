import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Coffee } from 'lucide-react';
import { PageShell } from '@/components/layout/PageShell';
import { Button } from '@/components/ui/button';
import { KOFI_URL } from '@/lib/constants';
import { apiFetch } from '@/lib/api';
import { SupporterBadge, type SupporterEntry } from '@/components/supporter/SupporterBadge';

function SupporterGroup({ title, people }: { title: string; people: SupporterEntry[] }) {
  if (people.length === 0) return null;
  return (
    <section>
      <h2 className="mb-3 font-display text-xl text-rizzotto-gold-400">{title}</h2>
      <ul className="flex flex-wrap gap-2">
        {people.map((s) => (
          <li
            key={s.userId}
            className="flex items-center gap-2 rounded border border-rizzotto-stone-800 bg-rizzotto-stone-900/40 px-3 py-1.5"
          >
            {s.avatarUrl && <img src={s.avatarUrl} alt="" className="size-6 rounded-full" />}
            <span className="text-sm text-rizzotto-stone-200">{s.username}</span>
            <SupporterBadge tiers={s.tiers} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SupportPage() {
  const { t } = useTranslation();

  const { data } = useQuery({
    queryKey: ['supporters'],
    queryFn: () => apiFetch<{ supporters: SupporterEntry[] }>('/api/supporters'),
  });
  const all = data?.supporters ?? [];
  // Each supporter appears once, in their highest tier (badges still show every tier they hold).
  const champions = all.filter((s) => s.tiers.champion);
  const lords = all.filter((s) => s.tiers.lord && !s.tiers.champion);
  const supporters = all.filter((s) => s.tiers.supporter && !s.tiers.lord && !s.tiers.champion);

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

        {all.length > 0 && (
          <div className="space-y-6 border-t border-rizzotto-stone-800 pt-8">
            <p className="text-rizzotto-stone-300">
              Every one of these players helps keep the Arena running and funds what comes next. Thank you.
            </p>
            <SupporterGroup title="Champions" people={champions} />
            <SupporterGroup title="Lords" people={lords} />
            <SupporterGroup title="Supporters" people={supporters} />
          </div>
        )}

        <p className="font-display italic tracking-wider text-rizzotto-stone-500">
          {t('support.motto')}
        </p>
      </div>
    </PageShell>
  );
}
