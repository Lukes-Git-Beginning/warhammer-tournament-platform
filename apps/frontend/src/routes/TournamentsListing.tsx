import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useAuthQuery } from '@/lib/auth.js';
import { ArrowRight, Clock, Crown, Users } from 'lucide-react';
import { listTournaments, type Tournament, type BattleType } from '@/lib/api.js';
import { formatInUserTimezone } from '@/lib/timezone.js';
import { DiscordTimestampButton } from '@/components/tournament/DiscordTimestampButton.js';
import { Team2v2Badge, BattleTypeWatermark } from '@/components/tournament/TournamentTypeBadges.js';
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
  FREE_PICK: 'Free Pick', ONE_V_THREE: '1v3',
  BLIND_PICK: 'Blind Pick', ONE_V_ONE: '1v1', THREE_V_THREE: '3v3',
  // 2v2 modes render without the "2v2" suffix — the 2v2 badge already marks the format.
  SFT_2V2: 'SFT', BPT_2V2: 'BPT',
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
      watermark={<BattleTypeWatermark battleType={tournament.battle_type} />}
    >
      <CardHeader>
        {tournament.poster_url && (
          <img
            src={tournament.poster_url}
            alt=""
            className="mb-3 aspect-[10/3] w-full rounded object-cover"
            loading="lazy"
          />
        )}
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {isDraft && (
              <Badge
                variant="default"
                className="border border-dashed border-rizzotto-gold-500/60 text-rizzotto-gold-300"
              >
                Draft · not published
              </Badge>
            )}
            {isLive && (
              <Badge variant="forge">
                <span className="size-1.5 animate-rizzotto-pulse rounded-full bg-rizzotto-forge-400" />
                {t('musters.status_live')}
              </Badge>
            )}
            {!isLive && !isCompleted && !isDraft && <Badge variant="gold">{t('musters.status_upcoming')}</Badge>}
            {isCompleted && <Badge variant="default">{t('musters.status_completed')}</Badge>}
            {tournament.is_major && (
              <Badge variant="major">
                <Crown className="size-3" strokeWidth={1.5} />
                Major
              </Badge>
            )}
          </div>
          {tournament.competitor_format === 'TWO_V_TWO' && <Team2v2Badge />}
        </div>
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
              : ['SWISS', 'LIECHTENSTEIN', 'BALANCED_LIECHTENSTEIN'].includes(tournament.format) && tournament.rounds_count ? ` · ${tournament.rounds_count}R` : ''}
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

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded border px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? 'border-rizzotto-gold-400/70 bg-rizzotto-gold-500/20 text-rizzotto-gold-300'
          : 'border-rizzotto-iron-700 text-rizzotto-stone-400 hover:border-rizzotto-iron-500 hover:text-rizzotto-stone-200'
      }`}
    >
      {children}
    </button>
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
  const battleType = search.battle_type as BattleType | undefined;
  const competitorFormat = search.competitor_format as Tournament['competitor_format'];

  // Merge a search patch, preserving the other filters. undefined values drop from the URL.
  const updateSearch = (patch: Partial<typeof search>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }) });

  const setPage = (p: number) => updateSearch({ page: p });
  const toggleMajor = () => updateSearch({ page: 1, major: majorOnly ? undefined : true });
  const setBattleType = (bt: typeof battleType) => updateSearch({ page: 1, battle_type: bt });
  const setCompetitorFormat = (cf: typeof competitorFormat) =>
    updateSearch({ page: 1, competitor_format: cf });

  const filters = { battleType, competitorFormat };

  // Active tournaments (live + upcoming) — fetched without status filter, split client-side
  const { data: activeData, isLoading: activeLoading } = useQuery({
    queryKey: ['tournaments-active', majorOnly, battleType, competitorFormat, viewerKey],
    queryFn: () => listTournaments(1, 50, undefined, majorOnly || undefined, filters),
    retry: false,
  });

  // Archive — paginated
  const { data: archiveData, isLoading: archiveLoading } = useQuery({
    queryKey: ['tournaments-archive', page, majorOnly, battleType, competitorFormat, viewerKey],
    queryFn: () =>
      listTournaments(
        page,
        PAGE_SIZE,
        'COMPLETED' as Tournament['status'],
        majorOnly || undefined,
        filters,
      ),
    retry: false,
  });

  const allActive = activeData?.data ?? [];
  // Match the landing page order: soonest start first (ONGOING is its own section above).
  const byStartAsc = (a: Tournament, b: Tournament) =>
    new Date(a.start_date).getTime() - new Date(b.start_date).getTime();
  const live = allActive.filter((t) => t.status === 'ONGOING').sort(byStartAsc);
  // Drafts appear here too, but the backend only returns a viewer's own drafts
  // (host/co-host) or — for staff — all of them, so they stay author-only.
  const upcoming = allActive
    .filter((t) => t.status !== 'ONGOING' && t.status !== 'COMPLETED')
    .sort(byStartAsc);
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

      {/* Filters — Majors · Battle type · Team size (all preserved in the URL) */}
      <div className="mb-8 flex flex-wrap items-center gap-x-6 gap-y-3">
        <FilterChip active={majorOnly} onClick={toggleMajor}>
          <Crown className="size-3.5" strokeWidth={1.5} />
          Majors only
        </FilterChip>

        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-rizzotto-stone-500">
            Type
          </span>
          <FilterChip active={!battleType} onClick={() => setBattleType(undefined)}>
            All
          </FilterChip>
          <FilterChip active={battleType === 'DOMINATION'} onClick={() => setBattleType('DOMINATION')}>
            Domination
          </FilterChip>
          <FilterChip active={battleType === 'CONQUEST'} onClick={() => setBattleType('CONQUEST')}>
            Conquest
          </FilterChip>
          <FilterChip active={battleType === 'SIEGE'} onClick={() => setBattleType('SIEGE')}>
            Siege
          </FilterChip>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-rizzotto-stone-500">
            Team
          </span>
          <FilterChip active={!competitorFormat} onClick={() => setCompetitorFormat(undefined)}>
            All
          </FilterChip>
          <FilterChip
            active={competitorFormat === 'ONE_V_ONE'}
            onClick={() => setCompetitorFormat('ONE_V_ONE')}
          >
            1v1
          </FilterChip>
          <FilterChip
            active={competitorFormat === 'TWO_V_TWO'}
            onClick={() => setCompetitorFormat('TWO_V_TWO')}
          >
            2v2
          </FilterChip>
        </div>
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
