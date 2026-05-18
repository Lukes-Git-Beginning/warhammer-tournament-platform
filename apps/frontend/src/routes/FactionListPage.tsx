import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { getFactions } from '@/lib/api';
import { FactionBadge } from '@/components/meta/FactionBadge';
import { PageShell } from '@/components/layout/PageShell';
import { EmptyState } from '@/components/ui/empty-state';
import type { FactionWithStatsDto } from '@tww3/types';

function FactionCard({ entry }: { entry: FactionWithStatsDto }) {
  const { t } = useTranslation();
  const { faction, stats } = entry;

  return (
    <Link
      to="/factions/$id"
      params={{ id: faction.id }}
      className="group flex flex-col items-center gap-2 rounded-md border border-rizzotto-iron-700/60 bg-rizzotto-iron-900/60 p-4 backdrop-blur-sm transition-colors hover:border-rizzotto-gold-500/50 hover:bg-rizzotto-iron-800/50"
    >
      <FactionBadge
        colorHex={faction.color_hex}
        initials={faction.initials}
        name={faction.name}
        size="md"
      />
      <span className="text-sm font-medium text-rizzotto-stone-200 text-center group-hover:text-rizzotto-gold-500 transition-colors leading-tight">
        {faction.name}
      </span>
      {stats ? (
        <div className="flex gap-3 text-xs text-rizzotto-stone-500">
          <span>{t('factions_page.matches_count', { count: stats.matches_played })}</span>
          <span>
            {stats.win_rate !== null
              ? t('factions_page.winrate_short', {
                  percent: Math.round(stats.win_rate * 100),
                })
              : '—'}
          </span>
        </div>
      ) : (
        <div className="text-xs text-rizzotto-stone-600">{t('factions_page.no_stats')}</div>
      )}
    </Link>
  );
}

export function FactionListPage() {
  const { t } = useTranslation();
  const { data, isLoading, error } = useQuery({
    queryKey: ['factions'],
    queryFn: () => getFactions(),
  });

  const hasNoSeason = !!data && !data.season;
  const hasData = !!data?.season && data.data.length > 0;

  return (
    <PageShell variant="wide">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold text-rizzotto-gold-500">
          {t('factions_page.title')}
        </h1>
        {data?.season && (
          <p className="mt-1 text-sm text-rizzotto-stone-500">
            {t('factions_page.season_label', { name: data.season.name })}
          </p>
        )}
      </header>

      {isLoading && (
        <div className="py-8 text-center text-rizzotto-stone-400 text-sm">
          {t('common.loading')}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-900 bg-red-950/40 p-4 text-red-300 text-sm">
          {t('factions_page.error')}
        </div>
      )}

      {hasNoSeason && (
        <EmptyState
          variant="sigil"
          title={t('factions_page.no_season_title')}
          body={t('factions_page.no_season_body')}
          motto={t('factions_page.no_season_motto')}
          mottoTitle={t('factions_page.no_season_motto_title')}
        />
      )}

      {hasData && data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {data.data.map((entry) => (
            <FactionCard key={entry.faction.id} entry={entry} />
          ))}
        </div>
      )}
    </PageShell>
  );
}
