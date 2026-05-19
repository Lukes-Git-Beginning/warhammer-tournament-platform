import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import DOMPurify from 'dompurify';
import { getTournament, getBracket, getParticipantMe } from '@/lib/api';
import { useAuthQuery } from '@/lib/auth';
import { formatInUserTimezone } from '@/lib/timezone';
import { BracketView } from '@/components/bracket/BracketView';
import { PageShell } from '@/components/layout/PageShell';
import { CheckInButton } from '@/components/tournament/CheckInButton';
import { ArmyListUploader } from '@/components/tournament/ArmyListUploader';
import type { ParticipantStatus } from '@/lib/api';

// Format labels are now handled via i18n — see t('tournament.format.*')
const FORMAT_KEY_MAP: Record<string, string> = {
  SINGLE_ELIMINATION: 'tournament.format.single_elim',
  SWISS: 'tournament.format.swiss',
  ROUND_ROBIN: 'tournament.format.round_robin',
  DOUBLE_ELIMINATION: 'tournament.format.double_elim',
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-stone-700 text-stone-300',
  OPEN_REGISTRATION: 'bg-emerald-800 text-emerald-200',
  REGISTRATION_CLOSED: 'bg-yellow-900 text-yellow-200',
  ONGOING: 'bg-warhammer-blood text-white',
  COMPLETED: 'bg-stone-600 text-stone-300',
};

// Sanitize markdown HTML output via DOMPurify
function SafeMarkdown({ children }: { children: string }) {
  const clean = DOMPurify.sanitize(children);
  return (
    <ReactMarkdown
      components={{
        // Override to use sanitized content
        p: ({ children: c }) => <p className="mb-3">{c}</p>,
        h2: ({ children: c }) => (
          <h2 className="font-display text-xl font-semibold mt-5 mb-2 text-warhammer-gold">{c}</h2>
        ),
        ul: ({ children: c }) => <ul className="list-disc pl-5 mb-3 space-y-1">{c}</ul>,
        ol: ({ children: c }) => <ol className="list-decimal pl-5 mb-3 space-y-1">{c}</ol>,
        code: ({ children: c }) => (
          <code className="rounded bg-stone-800 px-1 py-0.5 text-sm font-mono">{c}</code>
        ),
      }}
    >
      {clean}
    </ReactMarkdown>
  );
}

export function TournamentDetail() {
  const { t } = useTranslation();
  const { slug } = useParams({ from: '/tournaments/$slug' });
  const { data: user } = useAuthQuery();

  const { data: tournament, isLoading, error } = useQuery({
    queryKey: ['tournament', slug],
    queryFn: () => getTournament(slug),
    retry: false,
  });

  const { data: bracket } = useQuery({
    queryKey: ['bracket', slug],
    queryFn: () => getBracket(slug),
    enabled: !!tournament && (tournament.status === 'ONGOING' || tournament.status === 'COMPLETED'),
    refetchInterval: 15000,
  });

  // Fetch participant status for current user from the new endpoint
  const { data: participantData } = useQuery({
    queryKey: ['participant-me', slug],
    queryFn: () => getParticipantMe(slug),
    enabled: !!user,
    retry: false,
  });

  const activeDraftMatches = (bracket?.matches ?? []).filter(
    (m) => m.draft_id != null && m.draft_status === 'ONGOING',
  );

  if (isLoading) {
    return (
      <PageShell variant="narrow" className="text-rizzotto-stone-400">
        {t('common.loading')}
      </PageShell>
    );
  }

  if (error || !tournament) {
    return (
      <PageShell variant="narrow">
        <div className="rounded-md border border-red-900 bg-red-950/40 p-6 text-red-300 text-sm">
          {t('tournament.detail.not_found')}
        </div>
      </PageShell>
    );
  }

  const statusColor = STATUS_COLORS[tournament.status] ?? 'bg-stone-700 text-stone-300';
  const formatKey = FORMAT_KEY_MAP[tournament.format];
  const formatLabel = formatKey ? t(formatKey) : tournament.format;
  const startDate = formatInUserTimezone(tournament.start_date, user?.timezone ?? undefined);

  const canManage =
    user &&
    (user.role === 'MODERATOR' || user.role === 'ADMIN' ||
      (user.role === 'ORGANIZER' && tournament.organizer?.id === user.id));

  // Derive participant status from the /participants/me endpoint
  const participantStatus: ParticipantStatus | null = participantData?.status ?? null;

  // Derive current opponent from the active bracket match where user is a player
  const currentMatchOpponentId: string | undefined = (() => {
    if (!user || !bracket) return undefined;
    const activeMatch = bracket.matches.find(
      (m) =>
        (m.status === 'ONGOING' || m.status === 'PENDING') &&
        (m.player1Id === user.id || m.player2Id === user.id),
    );
    if (!activeMatch) return undefined;
    return activeMatch.player1Id === user.id
      ? (activeMatch.player2Id ?? undefined)
      : (activeMatch.player1Id ?? undefined);
  })();

  return (
    <PageShell variant="narrow">
      <div className="flex flex-wrap items-start gap-3 mb-6">
        <h1 className="font-display text-3xl font-bold text-rizzotto-gold-500 flex-1">
          {tournament.name}
        </h1>
        <div className="flex gap-2">
          <span className="rounded px-2 py-1 text-xs font-medium bg-stone-700 text-stone-200">
            {formatLabel}
          </span>
          <span className={`rounded px-2 py-1 text-xs font-medium ${statusColor}`}>
            {tournament.status}
          </span>
        </div>
      </div>

      {canManage && (
        <div className="flex gap-3 mb-6">
          <button
            type="button"
            className="rounded border border-stone-700 px-4 py-1.5 text-sm text-stone-300 hover:border-warhammer-gold hover:text-warhammer-gold transition-colors"
            onClick={() => {
              // Stub: Edit — M2+
            }}
          >
            {t('tournament.detail.edit')}
          </button>
          <button
            type="button"
            className="rounded border border-red-900 px-4 py-1.5 text-sm text-red-400 hover:border-red-600 hover:text-red-300 transition-colors"
            onClick={() => {
              // Stub: Delete — M2+
            }}
          >
            {t('tournament.detail.delete')}
          </button>
        </div>
      )}

      {/* ─── Check-in (for registered participants) ─── */}
      {user && participantStatus && (
        tournament.status === 'REGISTRATION_CLOSED' || tournament.status === 'ONGOING' || tournament.status === 'OPEN_REGISTRATION'
      ) && participantStatus !== 'WITHDRAWN' && participantStatus !== 'DISQUALIFIED' && (
        <section className="mb-6">
          <CheckInButton tournament={tournament} participantStatus={participantStatus} />
        </section>
      )}

      {/* ─── Army List Uploader (SLT only) ─── */}
      {user && tournament.mode === 'SLT' && participantStatus && (
        participantStatus === 'REGISTERED' || participantStatus === 'CHECKED_IN'
      ) && (
        <section className="mb-6">
          <h2 className="font-display text-lg font-semibold text-rizzotto-gold-500 mb-3">
            Army List
          </h2>
          <ArmyListUploader
            tournament={tournament}
            currentMatchOpponentId={currentMatchOpponentId}
          />
        </section>
      )}

      {activeDraftMatches.length > 0 && (
        <section className="mb-6 rounded-md border border-warhammer-blood/60 bg-warhammer-blood/10 p-4">
          <h2 className="font-display text-base font-semibold text-warhammer-gold mb-3 flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-warhammer-blood animate-pulse" />
            {t('tournament.detail.live_drafts')}
          </h2>
          <ul className="space-y-2">
            {activeDraftMatches.map((match) => (
              <li key={match.matchId} className="flex items-center justify-between rounded bg-stone-800/60 px-4 py-2">
                <span className="text-sm text-stone-300">
                  {t('tournament.detail.live_draft_label', {
                    matchNumber: match.matchNumber,
                    round: match.round,
                  })}
                </span>
                <Link
                  to="/drafts/$id/spectate"
                  params={{ id: match.draft_id! }}
                  className="rounded bg-warhammer-blood px-3 py-1 text-xs font-semibold text-white hover:bg-red-700 transition-colors"
                >
                  {t('tournament.detail.live_watch')}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 mb-8">
        <div className="space-y-2 text-sm">
          <div>
            <span className="text-stone-500">{t('tournament.detail.start')}</span>{' '}
            <span className="text-stone-200">{startDate}</span>
          </div>
          <div>
            <span className="text-stone-500">{t('tournament.detail.timezone')}</span>{' '}
            <span className="text-stone-200">{tournament.timezone}</span>
          </div>
          {tournament.max_participants && (
            <div>
              <span className="text-stone-500">{t('tournament.detail.max_participants')}</span>{' '}
              <span className="text-stone-200">{tournament.max_participants}</span>
            </div>
          )}
          {tournament.participantCount !== undefined && (
            <div>
              <span className="text-stone-500">{t('tournament.detail.registered')}</span>{' '}
              <span className="text-stone-200">{tournament.participantCount}</span>
            </div>
          )}
          {tournament.organizer && (
            <div>
              <span className="text-stone-500">{t('tournament.detail.organizer')}</span>{' '}
              <span className="text-stone-200">{tournament.organizer.username}</span>
            </div>
          )}
          {tournament.discord_link && (
            <div>
              <a
                href={tournament.discord_link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#5865F2] hover:underline"
              >
                {t('tournament.detail.discord_server')}
              </a>
            </div>
          )}
        </div>
      </div>

      {tournament.description && (
        <section className="mb-8">
          <h2 className="font-display text-xl font-semibold text-warhammer-gold mb-3">
            {t('tournament.detail.description')}
          </h2>
          <div className="text-stone-300 leading-relaxed">
            <SafeMarkdown>{tournament.description}</SafeMarkdown>
          </div>
        </section>
      )}

      {tournament.rules && (
        <section className="mb-8">
          <h2 className="font-display text-xl font-semibold text-warhammer-gold mb-3">
            {t('tournament.detail.rules')}
          </h2>
          <div className="rounded-md border border-stone-800 bg-stone-900/50 p-6 text-stone-300 leading-relaxed">
            <SafeMarkdown>{tournament.rules}</SafeMarkdown>
          </div>
        </section>
      )}

      {(tournament.status === 'ONGOING' || tournament.status === 'COMPLETED') && (
        <section>
          <h2 className="font-display text-xl font-semibold text-rizzotto-gold-500 mb-3">
            {t('tournament.detail.bracket')}
          </h2>
          <BracketView
            slug={tournament.slug}
            tournamentId={tournament.id}
            canManage={!!canManage}
          />
        </section>
      )}
    </PageShell>
  );
}
