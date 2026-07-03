import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useAuthQuery } from '@/lib/auth.js';
import { ArrowRight, Clock, Crown, Users } from 'lucide-react';
import { listTournaments, type Tournament } from '@/lib/api.js';
import { formatInUserTimezone } from '@/lib/timezone.js';
import { DiscordTimestampButton } from '@/components/tournament/DiscordTimestampButton.js';
import { PageShell } from '@/components/layout/PageShell.js';
import { Badge } from '@/components/ui/badge.js';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card.js';
import { EmptyState } from '@/components/ui/empty-state.js';
import { Separator } from '@/components/ui/separator.js';
import { Skeleton } from '@/components/ui/skeleton.js';

const PAGE_SIZE = 12;

const FORMAT_LABELS: Record<string, string> = {
  AUTO_SWISS: 'Auto Swiss',
  SINGLE_ELIMINATION: 'Single Elim.',
  DOUBLE_ELIMINATION: 'Double Elim.',
  SWISS: 'Swiss',
  ROUND_ROBIN: 'Round Robin',
  LIECHTENSTEIN: 'Liechtenstein',
  BALANCED_LIECHTENSTEIN: 'Balanced Liechtenstein',
};

const MODE_LABELS: Record<string, string> = {
  SFT: 'SFT', BPT: 'BPT', SLT: 'SLT', MATRIX: 'Matrix', TWO_D_THREE: '2D3',
  BLIND_PICK: 'Blind Pick', ONE_V_ONE: '1v1', THREE_V_THREE: '3v3',
};

function TournamentCard({ tournament }: { tournament: Tournament }) {
  const { t } = useTranslation();
  const { data: me } = useAuthQuery();
  const isLive = tournament.status === 'ONGOING';
  const isCompleted = tournament.status === 'COMPLETED';
  const isDraft = tournament.status === 'DRAFT';
  const startDate = formatInUserTimezone(tournament.start_date, me?.timezone ?? undefined);

  return (
    <Link
      to="/tournaments/$slug"
      params={{ slug: tournament.slug }}
      className="block group"
    >
    <Card
      variant="banner"
      interactive
      className={`flex h-full flex-col${isDraft ? ' border-2 border-dashed border-rizzotto-gold-500/40' : ''}`}
    >
      <CardHeader>
        {isDraft && (
          <Badge
            variant="default"
            className="self-start border border-dashed border-rizzotto-gold-500/60 text-rizzotto-gold-300"
          >
            Draft · not published
          </Badge>
        )}
        {isLive && (
          <Badge variant="forge" className="self-start">
            <span className="size-1.5 animate-rizzotto-pulse rounded-full bg-rizzotto-forge-400" />
            {t('musters.status_live')}
          </Badge>
        )}
        {!isLive && !isCompleted && !isDraft && (
          <Badge variant="gold" className="self-start">
            {t('musters.status_upcoming')}
          </Badge>
        )}
        {isCompleted && (
          <Badge variant="default" className="self-start">
            {t('musters.status_completed')}
          </Badge>
        )}
        {tournament.is_major && (
          <Badge variant="major" className="self-start">
            <Crown className="size-3" strokeWidth={1.5} />
            Major
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
            {FORMAT_LABELS[tournament.format] ?? tournament.format.replace(/_/g, ' ')}
            {tournament.format === 'AUTO_SWISS'
              ? (tournament.status === 'ONGOING' || tournament.status === 'COMPLETED') && tournament.rounds_count
                ? ` · ${tournament.rounds_count}R`
                : ' · TBD'
              : tournament.rounds_count ? ` · ${tournament.rounds_count}R` : ''}
          </span>
          {tournament.mode && (
            <span className="font-mono text-xs uppercase tracking-wide">
              {MODE_LABELS[tournament.mode] ?? tournament.mode}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex-1">
        {tournament.description && (
          <p className="line-clamp-3 text-sm text-rizzotto-stone-300">{tournament.description}</p>
        )}
      </CardContent>
      <Separator engraved className="mx-6 my-2" />
      <CardFooter>
        <span className="inline-flex items-center gap-1.5 font-mono text-xs text-rizzotto-stone-400">
          <Clock className="size-3.5" strokeWidth={1.5} />
          {startDate}
          <DiscordTimestampButton isoString={tournament.start_date} />
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-rizzotto-stone-400 group-hover:text-rizzotto-gold-400 transition-colors">
          {t('musters.answer_call')}
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
        <Skeleton key={i} className="h-64 rounded-lg" />
      ))}
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-display text-xl font-semibold text-rizzotto-gold-500 mb-5">
      {children}
    </h2>
  );
}

export function TournamentsListing() {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: '/tournaments' });
  const search = useSearch({ from: '/tournaments' });
  // Viewer identity is part of the query key so the list (which now includes the
  // viewer's own drafts) refetches when they sign in or out.
  const { data: me } = useAuthQuery();
  const viewerKey = me?.id ?? 'anon';

  const page = search.page ?? 1;
  const majorOnly = search.major === true;

  function setPage(p: number) {
    void navigate({ search: { tab: 'archive', page: p, major: majorOnly || undefined } });
  }

  function toggleMajor() {
    void navigate({
      search: { tab: 'upcoming', page: 1, major: majorOnly ? undefined : true },
    });
  }

  // Active tournaments (live + upcoming) — fetched without status filter, split client-side
  const { data: activeData, isLoading: activeLoading } = useQuery({
    queryKey: ['tournaments-active', majorOnly, viewerKey],
    queryFn: () => listTournaments(1, 50, undefined, majorOnly || undefined),
    retry: false,
  });

  // Archive — paginated
  const { data: archiveData, isLoading: archiveLoading } = useQuery({
    queryKey: ['tournaments-archive', page, majorOnly, viewerKey],
    queryFn: () =>
      listTournaments(page, PAGE_SIZE, 'COMPLETED' as Tournament['status'], majorOnly || undefined),
    retry: false,
  });

  const allActive = activeData?.data ?? [];
  const live = allActive.filter((t) => t.status === 'ONGOING');
  // Drafts appear here too, but the backend only returns a viewer's own drafts
  // (host/co-host) or — for staff — all of them, so they stay author-only.
  const upcoming = allActive.filter(
    (t) => t.status !== 'ONGOING' && t.status !== 'COMPLETED',
  );
  const archive = archiveData?.data ?? [];
  const archiveTotal = archiveData?.total ?? 0;
  const archiveTotalPages = Math.max(1, Math.ceil(archiveTotal / PAGE_SIZE));

  const isLoading = activeLoading;

  return (
    <PageShell variant="wide" spacing="base">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold text-rizzotto-gold-500">
          {t('header.tournaments')}
        </h1>
        <p className="mt-2 text-sm text-rizzotto-stone-400">{t('brand.tagline')}</p>
      </div>

      {/* Major filter */}
      <div className="mb-8 flex items-center gap-2">
        <button
          type="button"
          onClick={toggleMajor}
          className={`inline-flex items-center gap-2 rounded border px-3 py-1.5 text-sm font-medium transition-colors ${
            majorOnly
              ? 'border-rizzotto-gold-400/70 bg-rizzotto-gold-500/20 text-rizzotto-gold-300'
              : 'border-rizzotto-iron-700 text-rizzotto-stone-400 hover:border-rizzotto-iron-500 hover:text-rizzotto-stone-200'
          }`}
          aria-pressed={majorOnly}
        >
          <Crown className="size-3.5" strokeWidth={1.5} />
          Nur Majors
        </button>
      </div>

      {isLoading && <LoadingGrid />}

      {!isLoading && (
        <div className="space-y-14">

          {/* ── Live ── */}
          {live.length > 0 && (
            <section>
              <SectionHeading>Live Now</SectionHeading>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
                {live.map((t) => <TournamentCard key={t.id} tournament={t} />)}
              </div>
            </section>
          )}

          {/* ── Upcoming ── */}
          <section>
            <SectionHeading>Upcoming</SectionHeading>
            {upcoming.length === 0 ? (
              <EmptyState
                variant="banner"
                title={t('musters.empty_title')}
                body={t('musters.empty_body')}
                motto={t('musters.empty_motto')}
                mottoTitle="Where Lists Are Forged."
              />
            ) : (
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
                {upcoming.map((t) => <TournamentCard key={t.id} tournament={t} />)}
              </div>
            )}
          </section>

          {/* ── Archive ── */}
          <section>
            <SectionHeading>Archive</SectionHeading>
            {archiveLoading ? (
              <LoadingGrid />
            ) : archive.length === 0 ? (
              <p className="text-sm text-rizzotto-stone-500">No completed tournaments yet.</p>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
                  {archive.map((t) => <TournamentCard key={t.id} tournament={t} />)}
                </div>
                {archiveTotalPages > 1 && (
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
                      {t('common.page_of', { page, total: archiveTotalPages })}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPage(page + 1)}
                      disabled={page >= archiveTotalPages}
                      className="rounded border border-rizzotto-iron-700 px-3 py-1.5 text-rizzotto-stone-300 hover:border-rizzotto-iron-500 hover:text-rizzotto-stone-100 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
                    >
                      {t('common.next')} →
                    </button>
                  </div>
                )}
              </>
            )}
          </section>

        </div>
      )}
    </PageShell>
  );
}
