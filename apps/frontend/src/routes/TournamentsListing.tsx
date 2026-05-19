import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Clock, Users } from 'lucide-react';
import { listTournaments, type Tournament } from '@/lib/api.js';
import { PageShell } from '@/components/layout/PageShell.js';
import { Badge } from '@/components/ui/badge.js';
import { Button } from '@/components/ui/button.js';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card.js';
import { EmptyState } from '@/components/ui/empty-state.js';
import { Separator } from '@/components/ui/separator.js';
import { Skeleton } from '@/components/ui/skeleton.js';

type TournamentTab = 'upcoming' | 'live' | 'archive';

const PAGE_SIZE = 12;

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function TournamentCard({ tournament }: { tournament: Tournament }) {
  const { t } = useTranslation();
  const isLive = tournament.status === 'ONGOING';
  const isCompleted = tournament.status === 'COMPLETED';

  return (
    <Card variant="banner" interactive className="group flex h-full flex-col">
      <CardHeader>
        {isLive && (
          <Badge variant="forge" className="self-start">
            <span className="size-1.5 animate-rizzotto-pulse rounded-full bg-rizzotto-forge-400" />
            {t('musters.status_live')}
          </Badge>
        )}
        {!isLive && !isCompleted && (
          <Badge variant="gold" className="self-start">
            {t('musters.status_upcoming')}
          </Badge>
        )}
        {isCompleted && (
          <Badge variant="default" className="self-start">
            {t('musters.status_completed')}
          </Badge>
        )}
        <CardTitle className="line-clamp-2">{tournament.name}</CardTitle>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-rizzotto-stone-400">
          <span className="inline-flex items-center gap-1.5">
            <Users className="size-3.5" strokeWidth={1.5} />
            <span className="font-mono">
              {tournament.participantCount ?? '—'}
              {tournament.max_participants ? ` / ${tournament.max_participants}` : ''}
            </span>
          </span>
          <span className="font-mono text-xs uppercase tracking-wide">
            {tournament.format.replace(/_/g, ' ')}
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex-1">
        {tournament.description && (
          <p className="line-clamp-3 text-sm text-rizzotto-stone-300">{tournament.description}</p>
        )}
      </CardContent>
      <Separator engraved className="mx-6 my-2" />
      <CardFooter>
        <time
          dateTime={tournament.start_date}
          className="inline-flex items-center gap-1.5 font-mono text-xs text-rizzotto-stone-400"
        >
          <Clock className="size-3.5" strokeWidth={1.5} />
          {formatDate(tournament.start_date)}
        </time>
        <Button asChild variant="etched" size="sm">
          <Link to="/tournaments/$slug" params={{ slug: tournament.slug }}>
            {t('musters.answer_call')}
            <ArrowRight className="size-3.5" strokeWidth={1.5} />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

function LoadingGrid() {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-64 rounded-lg" />
      ))}
    </div>
  );
}

const TAB_LABELS: Record<TournamentTab, { en: string }> = {
  upcoming: { en: 'Upcoming' },
  live: { en: 'Live' },
  archive: { en: 'Archive' },
};

export function TournamentsListing() {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: '/tournaments' });
  const search = useSearch({ from: '/tournaments' });

  const activeTab: TournamentTab = search.tab ?? 'upcoming';
  const page = search.page ?? 1;

  // Map tab → backend status values. The API accepts a single status param;
  // for "upcoming" we default to OPEN_REGISTRATION which covers most real cases.
  // DRAFT and REGISTRATION_CLOSED are also shown in the card grid (no server-side
  // multi-status filter today) — we fetch all and display them.
  const statusParam = activeTab === 'live' ? 'ONGOING' : activeTab === 'archive' ? 'COMPLETED' : undefined;

  const { data, isLoading, isError } = useQuery({
    queryKey: ['tournaments-listing', activeTab, page],
    queryFn: () => listTournaments(page, PAGE_SIZE, statusParam as Tournament['status'] | undefined),
    retry: false,
  });

  const tournaments = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function setTab(tab: TournamentTab) {
    void navigate({ search: { tab, page: 1 } });
  }

  function setPage(p: number) {
    void navigate({ search: { tab: activeTab, page: p } });
  }

  const TABS: TournamentTab[] = ['upcoming', 'live', 'archive'];

  return (
    <PageShell variant="wide" spacing="base">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold text-rizzotto-gold-500">
          {t('header.tournaments')}
        </h1>
        <p className="mt-2 text-sm text-rizzotto-stone-400">{t('brand.tagline')}</p>
      </div>

      {/* Tab bar */}
      <div className="mb-6 flex gap-1 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-1 w-fit">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setTab(tab)}
            className={`rounded px-4 py-1.5 text-sm font-medium capitalize transition-colors ${
              activeTab === tab
                ? 'bg-rizzotto-gold-500/20 text-rizzotto-gold-500'
                : 'text-rizzotto-stone-400 hover:text-rizzotto-stone-200'
            }`}
          >
            {TAB_LABELS[tab].en}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading && <LoadingGrid />}

      {!isLoading && isError && (
        <div className="rounded-md border border-red-900 bg-red-950/40 p-4 text-red-300 text-sm">
          {t('errors.generic')}
        </div>
      )}

      {!isLoading && !isError && tournaments.length === 0 && (
        <EmptyState
          variant="banner"
          title={t('musters.empty_title')}
          body={t('musters.empty_body')}
          motto={t('musters.empty_motto')}
          mottoTitle="Where Lists Are Forged."
        />
      )}

      {!isLoading && !isError && tournaments.length > 0 && (
        <>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
            {tournaments.map((tournament) => (
              <TournamentCard key={tournament.id} tournament={tournament} />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-8 flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={() => setPage(page - 1)}
                disabled={page <= 1}
                className="rounded border border-rizzotto-iron-700 px-3 py-1.5 text-rizzotto-stone-300 hover:border-rizzotto-iron-500 hover:text-rizzotto-stone-100 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
              >
                ← {t('common.back')}
              </button>
              <span className="text-rizzotto-stone-500">
                {t('common.page_of', { page, total: totalPages })}
              </span>
              <button
                type="button"
                onClick={() => setPage(page + 1)}
                disabled={page >= totalPages}
                className="rounded border border-rizzotto-iron-700 px-3 py-1.5 text-rizzotto-stone-300 hover:border-rizzotto-iron-500 hover:text-rizzotto-stone-100 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
              >
                {t('common.next')} →
              </button>
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}
