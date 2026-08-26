import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { PageShell } from '@/components/layout/PageShell';
import { apiFetch } from '@/lib/api';
import { SupporterBadge, type SupporterEntry } from '@/components/supporter/SupporterBadge';
import { FundingSection } from '@/components/landing/FundingSection';

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
    <>
      {/* Prominent funding pitch — the same bold band as the landing page. */}
      <FundingSection />

      <PageShell variant="narrow">
        <div className="max-w-2xl space-y-8">
          <p className="text-sm text-rizzotto-stone-500">{t('support.note')}</p>

          <div id="hall-of-fame" className="scroll-mt-24 space-y-6 border-t border-rizzotto-stone-800 pt-8">
            <h2 className="font-display text-2xl font-bold text-rizzotto-gold-500">
              Supporter Hall of Fame
            </h2>
            {all.length > 0 ? (
              <>
                <p className="text-rizzotto-stone-300">
                  Every one of these players helps keep the Arena running and funds what comes next.
                  Thank you.
                </p>
                <SupporterGroup title="Champions" people={champions} />
                <SupporterGroup title="Lords" people={lords} />
                <SupporterGroup title="Supporters" people={supporters} />
              </>
            ) : (
              <p className="text-rizzotto-stone-400">
                No supporters yet — be the first, and you&rsquo;ll be listed here.
              </p>
            )}
          </div>

          <p className="font-display italic tracking-wider text-rizzotto-stone-500">
            {t('support.motto')}
          </p>
        </div>
      </PageShell>
    </>
  );
}
