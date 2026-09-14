import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowRight, Users } from 'lucide-react';
import { listSeries, type SeriesSummary } from '@/lib/api.js';
import { useAuthQuery } from '@/lib/auth.js';
import { PageShell } from '@/components/layout/PageShell.js';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card.js';
import { Badge } from '@/components/ui/badge.js';
import { Separator } from '@/components/ui/separator.js';
import { Skeleton } from '@/components/ui/skeleton.js';
import { EmptyState } from '@/components/ui/empty-state.js';

const PAGE_SIZE = 20;

const MODEL_LABELS: Record<string, string> = {
  A: 'Points race',
  C: 'Per-qualifier',
};

function SeriesCard({ series }: { series: SeriesSummary }) {
  return (
    <Link to="/series/$slug" params={{ slug: series.slug }} className="block group">
      <Card
        variant="banner"
        interactive
        className="flex h-full flex-col"
      >
        <CardHeader>
          {series.poster_url && (
            <img
              src={series.poster_url}
              alt=""
              className="mb-3 aspect-[10/3] w-full rounded object-cover"
              loading="lazy"
            />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={series.visibility === 'PRIVATE' ? 'default' : 'gold'}>
              {series.visibility === 'PRIVATE' ? 'Private' : 'Public'}
            </Badge>
            <Badge variant="default" className="font-mono text-xs uppercase">
              {MODEL_LABELS[series.scoring_config.model] ?? series.scoring_config.model}
            </Badge>
          </div>
          <CardTitle className="line-clamp-2">{series.name}</CardTitle>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-rizzotto-stone-400">
            <span className="inline-flex items-center gap-1.5">
              <Users className="size-3.5" strokeWidth={1.5} />
              <span className="font-mono">{series.qualifierCount} qualifier{series.qualifierCount !== 1 ? 's' : ''}</span>
            </span>
            <span className="text-xs text-rizzotto-stone-500">
              by {series.owner.username}
            </span>
          </div>
        </CardHeader>
        <CardContent className="flex-1">
          {series.final && (
            <p className="text-sm text-rizzotto-stone-400">
              Final: <span className="text-rizzotto-stone-200">{series.final.name}</span>
            </p>
          )}
        </CardContent>
        <Separator engraved className="mx-6 my-2" />
        <CardFooter>
          <span />
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-rizzotto-stone-400 group-hover:text-rizzotto-gold-400 transition-colors">
            View Series
            <ArrowRight className="size-3.5" strokeWidth={1.5} />
          </span>
        </CardFooter>
      </Card>
    </Link>
  );
}

function LoadingGrid() {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-48 rounded-lg" />
      ))}
    </div>
  );
}

export function SeriesListingPage() {
  const { data: me } = useAuthQuery();
  const [page, setPage] = useState(1);

  const canCreate =
    me?.role === 'HOST' || me?.role === 'MODERATOR' || me?.role === 'ADMIN';

  const { data, isLoading } = useQuery({
    queryKey: ['series', page],
    queryFn: () => listSeries(page, PAGE_SIZE),
    retry: false,
  });

  const series = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <PageShell variant="wide" spacing="base">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-rizzotto-gold-500">
            Tournament Series
          </h1>
          <p className="mt-2 text-sm text-rizzotto-stone-400">
            Multi-event series tracking standings across qualifying tournaments.
          </p>
        </div>
        {canCreate && (
          <Link
            to="/series/new"
            className="shrink-0 rounded border border-rizzotto-gold-500/60 px-4 py-2 text-sm font-semibold text-rizzotto-gold-400 hover:bg-rizzotto-gold-500/10 transition-colors"
          >
            Create Series
          </Link>
        )}
      </div>

      {isLoading && <LoadingGrid />}

      {!isLoading && series.length === 0 && (
        <EmptyState
          variant="banner"
          title="No series yet"
          body="Series track standings across multiple qualifier tournaments leading to a grand final."
          motto="The road to glory is paved with qualifiers."
          mottoTitle="May the best player prevail."
        />
      )}

      {!isLoading && series.length > 0 && (
        <>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
            {series.map((s) => (
              <SeriesCard key={s.id} series={s} />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="mt-8 flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={() => setPage((p) => p - 1)}
                disabled={page <= 1}
                className="rounded border border-rizzotto-iron-700 px-3 py-1.5 text-rizzotto-stone-300 hover:border-rizzotto-iron-500 hover:text-rizzotto-stone-100 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
              >
                ← Back
              </button>
              <span className="text-rizzotto-stone-500">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= totalPages}
                className="rounded border border-rizzotto-iron-700 px-3 py-1.5 text-rizzotto-stone-300 hover:border-rizzotto-iron-500 hover:text-rizzotto-stone-100 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}
