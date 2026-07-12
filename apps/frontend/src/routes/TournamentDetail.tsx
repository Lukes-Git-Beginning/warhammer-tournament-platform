import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import DOMPurify from 'dompurify';
import {
  addLateJoiner,
  createMatchNode,
  deleteTournament,
  dropParticipant,
  getBracket,
  getFactions,
  getParticipantMe,
  getParticipants,
  getTournament,
  patchTournament,
  resetBracket,
  startTournament,
} from '@/lib/api';
import type { FactionDto } from '@rizzotto/types';
import { useAuthQuery } from '@/lib/auth';
import { formatInUserTimezone } from '@/lib/timezone';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import { FORMAT_DESCRIPTIONS, MODE_DESCRIPTIONS } from '@/lib/tournamentDescriptions';
import { useLiveBracket } from '@/hooks/useLiveBracket';
import { sortStandingsByPlayoffResult, getFinalistIds, getSemifinalistIds } from '@/lib/bracketStandings';
import { BracketView } from '@/components/bracket/BracketView';
import { SwissStandings } from '@/components/bracket/SwissStandings';
import { EliminationStandings } from '@/components/bracket/EliminationStandings';
import { PageShell } from '@/components/layout/PageShell';
import { CheckInButton } from '@/components/tournament/CheckInButton';
import { RegisterButton } from '@/components/tournament/RegisterButton';
import { DiscordTimestampButton } from '@/components/tournament/DiscordTimestampButton';
import { ParticipantsList } from '@/components/tournament/ParticipantsList';
import { LateJoinRequestsPanel } from '@/components/tournament/LateJoinRequestsPanel';
import { StandardRulesetCard } from '@/components/tournament/StandardRulesetCard';
import { ArmyListUploader } from '@/components/tournament/ArmyListUploader';
import { MyMatchSection } from '@/components/match/MyMatchSection';
import type { ParticipantStatus } from '@/lib/api';


// Format labels are now handled via i18n — see t('tournament.format.*')
const FORMAT_KEY_MAP: Record<string, string> = {
  SINGLE_ELIMINATION: 'tournament.format.single_elim',
  SWISS: 'tournament.format.swiss',
  ROUND_ROBIN: 'tournament.format.round_robin',
  DOUBLE_ELIMINATION: 'tournament.format.double_elim',
  LIECHTENSTEIN: 'tournament.format.liechtenstein',
  BALANCED_LIECHTENSTEIN: 'tournament.format.balanced_liechtenstein',
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-stone-700 text-stone-300',
  OPEN_REGISTRATION: 'bg-emerald-800 text-emerald-200',
  REGISTRATION_CLOSED: 'bg-yellow-900 text-yellow-200',
  ONGOING: 'bg-rizzotto-blood-500 text-white',
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
          <h2 className="font-display text-xl font-semibold mt-5 mb-2 text-rizzotto-gold-500">{c}</h2>
        ),
        ul: ({ children: c }) => <ul className="list-disc pl-5 mb-3 space-y-1">{c}</ul>,
        ol: ({ children: c }) => <ol className="list-decimal pl-5 mb-3 space-y-1">{c}</ol>,
        code: ({ children: c }) => (
          <code className="rounded bg-stone-800 px-1 py-0.5 text-sm font-mono">{c}</code>
        ),
        blockquote: ({ children: c }) => (
          <blockquote className="border-l-[3px] border-rizzotto-gold-500 pl-3 my-2 italic text-rizzotto-stone-300">{c}</blockquote>
        ),
        a: ({ children: c, href }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-rizzotto-gold-400 underline hover:text-rizzotto-gold-300">{c}</a>
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
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: tournament, isLoading, error } = useQuery({
    queryKey: ['tournament', slug],
    queryFn: () => getTournament(slug),
    retry: false,
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteTournament(slug),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tournaments'] });
      void navigate({ to: '/tournaments', search: { tab: 'upcoming', page: 1 } });
    },
  });

  const publishMutation = useMutation({
    mutationFn: () => patchTournament(slug, { status: 'OPEN_REGISTRATION' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tournament', slug] });
      void queryClient.invalidateQueries({ queryKey: ['tournaments'] });
    },
  });

  const closeRegistrationMutation = useMutation({
    mutationFn: () => patchTournament(slug, { status: 'REGISTRATION_CLOSED' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tournament', slug] });
      void queryClient.invalidateQueries({ queryKey: ['tournaments'] });
    },
  });

  const startMutation = useMutation({
    mutationFn: (id: string) => startTournament(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tournament', slug] });
      void queryClient.invalidateQueries({ queryKey: ['bracket', slug] });
      void queryClient.invalidateQueries({ queryKey: ['tournaments'] });
    },
  });

  const resetBracketMutation = useMutation({
    mutationFn: (id: string) => resetBracket(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tournament', slug] });
      void queryClient.invalidateQueries({ queryKey: ['bracket', slug] });
    },
  });

  const completeMutation = useMutation({
    mutationFn: () => patchTournament(slug, { status: 'COMPLETED' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tournament', slug] });
      void queryClient.invalidateQueries({ queryKey: ['tournaments'] });
    },
  });

  const selfDropMutation = useMutation({
    mutationFn: (userId: string) => dropParticipant(slug, userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tournament', slug] });
      void queryClient.invalidateQueries({ queryKey: ['tournament-participants', slug] });
      void queryClient.invalidateQueries({ queryKey: ['bracket', slug] });
      void queryClient.invalidateQueries({ queryKey: ['participant-me', slug] });
    },
  });

  const lateJoinMutation = useMutation({
    mutationFn: (userId: string) => addLateJoiner(slug, userId),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['tournament-participants', slug] });
      void queryClient.invalidateQueries({ queryKey: ['bracket', slug] });
      alert(`${data.participant.user.username} added as late joiner.`);
    },
    onError: (err: Error) => alert(`Error: ${err.message}`),
  });

  const [showCreateMatch, setShowCreateMatch] = useState(false);
  const [createP1Id, setCreateP1Id] = useState('');
  const [createP2Id, setCreateP2Id] = useState('');
  const [createRound, setCreateRound] = useState(1);
  const [createMatchError, setCreateMatchError] = useState<string | null>(null);
  const createMatchMutation = useMutation({
    mutationFn: () => createMatchNode(slug, createP1Id, createP2Id, createRound),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bracket', slug] });
      setShowCreateMatch(false);
      setCreateP1Id('');
      setCreateP2Id('');
      setCreateMatchError(null);
    },
    onError: (err: Error) => setCreateMatchError(err.message),
  });

  const { data: bracket } = useQuery({
    queryKey: ['bracket', slug],
    queryFn: () => getBracket(slug),
    enabled: !!tournament && (
      tournament.status === 'ONGOING' ||
      tournament.status === 'COMPLETED' ||
      tournament.status === 'REGISTRATION_CLOSED'
    ),
    refetchInterval: 15000,
    staleTime: 0,
  });

  // Shared cache with BracketView — faction data for SwissStandings faction column.
  const { data: factionsData } = useQuery({
    queryKey: ['factions'],
    queryFn: () => getFactions(),
    staleTime: 60 * 60_000,
  });
  const standingsFactionMap = new Map<string, FactionDto>(
    (factionsData?.data ?? []).map((f) => [f.faction.id, f.faction]),
  );
  const standingsPlayerFactionMap = new Map<string, string>();
  for (const m of bracket?.matches ?? []) {
    if (m.player1Id && m.player1FactionId && !standingsPlayerFactionMap.has(m.player1Id)) {
      standingsPlayerFactionMap.set(m.player1Id, m.player1FactionId);
    }
    if (m.player2Id && m.player2FactionId && !standingsPlayerFactionMap.has(m.player2Id)) {
      standingsPlayerFactionMap.set(m.player2Id, m.player2FactionId);
    }
  }
  const standingsFinalistIds = useMemo(
    () => getFinalistIds(bracket?.matches ?? []),
    [bracket?.matches],
  );
  const standingsSemifinalistIds = useMemo(
    () => getSemifinalistIds(bracket?.matches ?? []),
    [bracket?.matches],
  );
  const sortedStandings = useMemo(() => {
    const swiss = bracket?.swiss;
    if (!swiss?.standings || !bracket?.matches) return swiss?.standings;
    return sortStandingsByPlayoffResult(swiss.standings, bracket.matches);
  }, [bracket?.swiss?.standings, bracket?.matches]);

  // Drive standings updates from socket events directly, not via BracketView
  useLiveBracket(tournament?.id ?? '');

  // Participants — shared cache with BracketView and ParticipantsList
  const { data: participantsData } = useQuery({
    queryKey: ['tournament-participants', slug],
    queryFn: () => getParticipants(slug),
    enabled: !!tournament && tournament.status !== 'DRAFT',
  });

  // Fetch participant status for current user from the new endpoint
  const { data: participantData } = useQuery({
    queryKey: ['participant-me', slug],
    queryFn: () => getParticipantMe(slug),
    enabled: !!user,
    retry: false,
  });

  const participantStatusMap = useMemo(
    () => new Map((participantsData?.data ?? []).map((p) => [p.user.id, p.status])),
    [participantsData],
  );

  // TWO_D_THREE: userId → the player's 3-faction pool, for the standings column.
  const standingsPlayerFactionPoolMap = useMemo(
    () => new Map((participantsData?.data ?? []).map((p) => [p.user.id, p.faction_ids])),
    [participantsData],
  );

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

  // Server-computed (host, co-host, moderator, admin) — co-hosts now get the full
  // management UI, not just the host.
  const canManage = !!tournament.can_manage;

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
      {tournament.poster_url && (
        <img
          src={tournament.poster_url}
          alt={`${tournament.name} poster`}
          className="mb-6 max-h-72 w-full rounded-lg border border-stone-800 object-cover"
          loading="lazy"
        />
      )}
      <div className="flex flex-wrap items-start gap-3 mb-6">
        <h1 className="font-display text-3xl font-bold text-rizzotto-gold-500 flex-1">
          {tournament.name}
        </h1>
        <div className="flex gap-2">
          <InfoTooltip text={FORMAT_DESCRIPTIONS[tournament.format]}>
            <span className="rounded px-2 py-1 text-xs font-medium bg-stone-700 text-stone-200">
              {formatLabel}
            </span>
          </InfoTooltip>
          <span className={`rounded px-2 py-1 text-xs font-medium ${statusColor}`}>
            {tournament.status}
          </span>
        </div>
      </div>

      {canManage && (
        <div className="flex flex-wrap gap-3 mb-6">
          <button
            type="button"
            className="rounded border border-stone-700 px-4 py-1.5 text-sm text-stone-300 hover:border-rizzotto-gold-500 hover:text-rizzotto-gold-500 transition-colors"
            onClick={() => navigate({ to: '/tournaments/$slug/edit', params: { slug } })}
          >
            {t('tournament.detail.edit')}
          </button>
          {tournament.status === 'DRAFT' && (
            <button
              type="button"
              disabled={publishMutation.isPending}
              className="rounded border border-rizzotto-gold-500 px-4 py-1.5 text-sm text-rizzotto-gold-500 hover:bg-rizzotto-gold-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => {
                if (
                  confirm(
                    t('tournament.detail.publish_confirm', { name: tournament.name }),
                  )
                ) {
                  publishMutation.mutate();
                }
              }}
            >
              {t('tournament.detail.publish')}
            </button>
          )}
          {tournament.status === 'OPEN_REGISTRATION' && (
            <button
              type="button"
              disabled={closeRegistrationMutation.isPending}
              className="rounded border border-rizzotto-gold-500 px-4 py-1.5 text-sm text-rizzotto-gold-500 hover:bg-rizzotto-gold-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => {
                if (
                  confirm(
                    t('tournament.detail.close_registration_confirm', { name: tournament.name }),
                  )
                ) {
                  closeRegistrationMutation.mutate();
                }
              }}
            >
              {t('tournament.detail.close_registration')}
            </button>
          )}
          {tournament.status === 'REGISTRATION_CLOSED' && (
            <button
              type="button"
              disabled={startMutation.isPending}
              className="rounded bg-rizzotto-gold-500 px-4 py-1.5 text-sm font-semibold text-rizzotto-iron-950 hover:bg-rizzotto-gold-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => {
                if (
                  confirm(
                    t('tournament.detail.start_tournament_confirm', { name: tournament.name }),
                  )
                ) {
                  startMutation.mutate(tournament.id);
                }
              }}
            >
              {startMutation.isPending
                ? t('tournament.detail.start_tournament_pending')
                : t('tournament.detail.start_tournament')}
            </button>
          )}
          {startMutation.isError && (
            <span className="self-center text-xs text-rizzotto-danger">
              {(startMutation.error as Error).message}
            </span>
          )}
          {tournament.status === 'ONGOING' && (
            <button
              type="button"
              disabled={completeMutation.isPending}
              className="rounded border border-rizzotto-gold-500 px-4 py-1.5 text-sm text-rizzotto-gold-500 hover:bg-rizzotto-gold-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => {
                if (confirm(`Finalise "${tournament.name}"? Placements will be calculated. This cannot be undone.`)) {
                  completeMutation.mutate();
                }
              }}
            >
              {completeMutation.isPending ? 'Finalising…' : 'Finalise Tournament'}
            </button>
          )}
          {/* B21: also available pre-start (REGISTRATION_CLOSED), not just ONGOING. */}
          {(tournament.status === 'ONGOING' || tournament.status === 'REGISTRATION_CLOSED') && (
            <button
              type="button"
              disabled={lateJoinMutation.isPending}
              onClick={() => {
                const userId = prompt('Enter the User ID of the player to add (find it in Admin → Users):');
                if (userId?.trim()) lateJoinMutation.mutate(userId.trim());
              }}
              className="rounded border border-rizzotto-gold-500/40 px-3 py-1.5 text-sm text-rizzotto-gold-400 hover:border-rizzotto-gold-400 hover:text-rizzotto-gold-300 transition-colors disabled:opacity-40"
            >
              + Add Late Joiner
            </button>
          )}
          {(tournament.status === 'ONGOING' || tournament.status === 'REGISTRATION_CLOSED') && (
            <button
              type="button"
              onClick={() => { setShowCreateMatch(true); setCreateRound(bracket?.swiss?.currentRound ?? 1); }}
              className="rounded border border-rizzotto-gold-500/40 px-3 py-1.5 text-sm text-rizzotto-gold-400 hover:border-rizzotto-gold-400 hover:text-rizzotto-gold-300 transition-colors"
            >
              + Create Match
            </button>
          )}
          {tournament.status === 'ONGOING' && (
            <button
              type="button"
              disabled={resetBracketMutation.isPending}
              className="rounded border border-orange-900 px-4 py-1.5 text-sm text-orange-400 hover:border-orange-600 hover:text-orange-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => {
                if (
                  confirm(
                    `Reset bracket for "${tournament.name}"? All match results will be deleted and status returns to REGISTRATION_CLOSED.`,
                  )
                ) {
                  resetBracketMutation.mutate(tournament.id);
                }
              }}
            >
              {resetBracketMutation.isPending ? 'Resetting…' : 'Reset Bracket'}
            </button>
          )}
          <button
            type="button"
            disabled={deleteMutation.isPending}
            className="rounded border border-red-900 px-4 py-1.5 text-sm text-red-400 hover:border-red-600 hover:text-red-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => {
              if (
                confirm(t('tournament.detail.delete_confirm', { name: tournament.name }))
              ) {
                deleteMutation.mutate();
              }
            }}
          >
            {t('tournament.detail.delete')}
          </button>
          {resetBracketMutation.isError && (
            <span className="self-center text-xs text-rizzotto-danger">
              {(resetBracketMutation.error as Error).message}
            </span>
          )}
        </div>
      )}

      {/* ─── Create Match Modal ─── */}
      {showCreateMatch && canManage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={(e) => { if (e.target === e.currentTarget) setShowCreateMatch(false); }}>
          <div className="bg-stone-900 border border-stone-700 rounded-lg p-6 w-full max-w-sm shadow-xl">
            <h2 className="font-display text-lg font-semibold text-rizzotto-gold-500 mb-4">Create Match Node</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-stone-400 block mb-1">Player 1</label>
                <select
                  value={createP1Id}
                  onChange={(e) => { setCreateP1Id(e.target.value); setCreateMatchError(null); }}
                  className="w-full rounded border border-stone-700 bg-stone-800 px-2 py-1.5 text-sm text-stone-200 focus:outline-none focus:border-rizzotto-gold-500"
                >
                  <option value="">— select player —</option>
                  {(participantsData?.data ?? [])
                    .filter((p) => p.user.id !== createP2Id)
                    .map((p) => <option key={p.user.id} value={p.user.id}>{p.user.username}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-stone-400 block mb-1">Player 2</label>
                <select
                  value={createP2Id}
                  onChange={(e) => { setCreateP2Id(e.target.value); setCreateMatchError(null); }}
                  className="w-full rounded border border-stone-700 bg-stone-800 px-2 py-1.5 text-sm text-stone-200 focus:outline-none focus:border-rizzotto-gold-500"
                >
                  <option value="">— Bye (no opponent) —</option>
                  {(participantsData?.data ?? [])
                    .filter((p) => p.user.id !== createP1Id)
                    .map((p) => <option key={p.user.id} value={p.user.id}>{p.user.username}</option>)}
                </select>
                {!createP2Id && (
                  <p className="mt-1 text-xs text-stone-500">Leave empty to create a bye — a free win for Player 1.</p>
                )}
              </div>
              <div>
                <label className="text-xs text-stone-400 block mb-1">Round</label>
                <input
                  type="number"
                  min={1}
                  value={createRound}
                  onChange={(e) => setCreateRound(Number(e.target.value))}
                  className="w-full rounded border border-stone-700 bg-stone-800 px-2 py-1.5 text-sm text-stone-200 focus:outline-none focus:border-rizzotto-gold-500"
                />
              </div>
              {createMatchError && <p className="text-xs text-red-400">{createMatchError}</p>}
            </div>
            <div className="flex gap-3 justify-end mt-5">
              <button type="button" onClick={() => setShowCreateMatch(false)} className="px-4 py-1.5 text-sm text-stone-400 hover:text-stone-200">
                Cancel
              </button>
              <button
                type="button"
                disabled={!createP1Id || createMatchMutation.isPending}
                onClick={() => createMatchMutation.mutate()}
                className="px-4 py-1.5 text-sm rounded bg-rizzotto-blood-500 text-white font-medium hover:opacity-90 disabled:opacity-40"
              >
                {createMatchMutation.isPending ? 'Creating…' : createP2Id ? 'Create Match' : 'Create Bye'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Registration / late-join CTA ─── */}
      {(tournament.status === 'OPEN_REGISTRATION' ||
        (tournament.status === 'ONGOING' && tournament.allow_late_join_requests)) && (
        <section className="mb-6">
          <RegisterButton
            tournament={tournament}
            participantStatus={participantStatus}
            isLoggedIn={!!user}
            userId={user?.id}
          />
        </section>
      )}

      {/* ─── Check-in (for registered participants, pre-start only) ─── */}
      {user && participantStatus && (
        tournament.status === 'REGISTRATION_CLOSED' || tournament.status === 'OPEN_REGISTRATION'
      ) && participantStatus !== 'WITHDREW' && participantStatus !== 'DISQUALIFIED' && (
        <section className="mb-6">
          <CheckInButton tournament={tournament} participantStatus={participantStatus} />
        </section>
      )}

      {/* ─── Self-Drop (active participants during ONGOING) ─── */}
      {user && tournament.status === 'ONGOING' &&
        (participantStatus === 'REGISTERED' || participantStatus === 'CHECKED_IN') && (
        <section className="mb-6">
          {(() => {
            const openMatch = (bracket?.matches ?? []).find(
              (m) =>
                (m.status === 'PENDING' || m.status === 'ONGOING') &&
                (m.player1Id === user.id || m.player2Id === user.id),
            );
            const opponentId = openMatch
              ? (openMatch.player1Id === user.id ? openMatch.player2Id : openMatch.player1Id)
              : null;
            const opponentName = opponentId
              ? participantsData?.data.find((p) => p.user.id === opponentId)?.user.username
              : null;
            return (
              <button
                type="button"
                disabled={selfDropMutation.isPending}
                className="rounded border border-red-800 px-4 py-1.5 text-sm text-red-400 hover:border-red-600 hover:text-red-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => {
                  const warning = openMatch
                    ? `You have an open match against ${opponentName ?? 'your opponent'}. If you drop, they win the match automatically. Drop anyway?`
                    : 'Drop from this tournament? Your existing results will be kept.';
                  if (confirm(warning)) {
                    selfDropMutation.mutate(user.id);
                  }
                }}
              >
                {selfDropMutation.isPending ? 'Dropping…' : 'Drop from Tournament'}
              </button>
            );
          })()}
          {selfDropMutation.isError && (
            <p className="mt-2 text-xs text-rizzotto-danger">
              {(selfDropMutation.error as Error).message}
            </p>
          )}
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
        <section className="mb-6 rounded-md border border-rizzotto-blood-500/60 bg-rizzotto-blood-500/10 p-4">
          <h2 className="font-display text-base font-semibold text-rizzotto-gold-500 mb-3 flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-rizzotto-blood-500 animate-pulse" />
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
                  className="rounded bg-rizzotto-blood-500 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700 transition-colors"
                >
                  {t('tournament.detail.live_watch')}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Tournament meta info                                                */}
      {/* ------------------------------------------------------------------ */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 mb-8">
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-stone-500">{t('tournament.detail.start')}</span>{' '}
            <span className="text-stone-200">{startDate}</span>
            <DiscordTimestampButton isoString={tournament.start_date} />
          </div>
          {tournament.format && (
            <div>
              <span className="text-stone-500">Format:</span>{' '}
              <span className="text-stone-200">
                {({ AUTO_SWISS: 'Auto Swiss', SWISS: 'Swiss', SINGLE_ELIMINATION: 'Single Elimination', DOUBLE_ELIMINATION: 'Double Elimination', ROUND_ROBIN: 'Round Robin', LIECHTENSTEIN: 'Liechtenstein', BALANCED_LIECHTENSTEIN: 'Balanced Liechtenstein' } as Record<string, string>)[tournament.format] ?? tournament.format}
                {tournament.format !== 'AUTO_SWISS' && tournament.rounds_count ? ` · ${tournament.rounds_count} Rounds` : ''}
                {tournament.format === 'AUTO_SWISS' && tournament.status === 'ONGOING' && tournament.rounds_count ? ` · ${tournament.rounds_count} Rounds` : ''}
                {tournament.format === 'AUTO_SWISS' && tournament.status !== 'ONGOING' && tournament.status !== 'COMPLETED' ? ' · Rounds TBD' : ''}
              </span>
            </div>
          )}
          {(tournament.mode || tournament.format === 'AUTO_SWISS') && (
            <div>
              <span className="text-stone-500">Mode:</span>{' '}
              <InfoTooltip text={MODE_DESCRIPTIONS[tournament.mode ?? '']}>
                <span className="text-stone-200 underline decoration-dotted decoration-stone-600 underline-offset-2">
                  {(({ SFT: 'SFT', BPT: 'BPT', SLT: 'SLT', MATRIX: 'Matrix', TWO_D_THREE: '2D3', FREE_PICK: "Enticity's Free Pick", ONE_V_THREE: '1v3', BLIND_PICK: 'Blind Pick', ONE_V_ONE: '1v1', THREE_V_THREE: '3v3' } as Record<string, string>)[tournament.mode ?? ''] ?? tournament.mode ?? 'SFT')}
                </span>
              </InfoTooltip>
            </div>
          )}
          {tournament.max_participants && (
            <div>
              <span className="text-stone-500">{t('tournament.detail.max_participants')}</span>{' '}
              <span className="text-stone-200">
                {tournament.participantCount !== undefined ? `${tournament.participantCount} / ` : ''}{tournament.max_participants}
              </span>
            </div>
          )}
          {tournament.host && (
            <div>
              <span className="text-stone-500">{t('tournament.detail.organizer')}</span>{' '}
              <Link
                to="/users/$id"
                params={{ id: tournament.host.id }}
                className="text-stone-200 hover:text-rizzotto-gold-400 transition-colors"
              >
                {tournament.host.username}
              </Link>
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
          {tournament.stream_url && (
            <div>
              <a
                href={tournament.stream_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-rizzotto-gold-400 hover:underline"
              >
                📺 Watch the stream
              </a>
            </div>
          )}
        </div>
      </div>

      {/* B11: every Arena tournament requires the same map pack — hardcoded notice. */}
      <div className="mb-8 rounded-md border border-rizzotto-gold-500/30 bg-rizzotto-gold-500/5 px-4 py-3 text-sm">
        <span className="text-stone-300">Required mod for all Arena tournaments: </span>
        <a
          href="https://steamcommunity.com/sharedfiles/filedetails/?id=2875865414"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-rizzotto-gold-400 hover:underline"
        >
          Total Tavern Tournament Map Pack ↗
        </a>
      </div>

      {/* Faction allowlist, banned factions and restricted factions */}
      {(() => {
        const factionMap = new Map((factionsData?.data ?? []).map((f) => [f.faction.id, f.faction]));
        const allFactionList = [...factionMap.values()];

        const hasAllowlist = tournament.faction_allowlist && tournament.faction_allowlist.length > 0;
        const allowedFactions: FactionDto[] = hasAllowlist
          ? (tournament.faction_allowlist ?? []).map((id) => factionMap.get(id)).filter((f): f is FactionDto => f !== undefined)
          : [];

        const bannedFactions: FactionDto[] = hasAllowlist
          ? allFactionList.filter((f) => !(tournament.faction_allowlist ?? []).includes(f.id))
          : [];

        const restrictedIds = tournament.restricted_factions ?? [];
        const restrictedFactions: FactionDto[] = restrictedIds
          .map((id) => factionMap.get(id))
          .filter((f): f is FactionDto => f !== undefined);

        const hasBanned = bannedFactions.length > 0;
        const hasRestricted = restrictedFactions.length > 0;

        if (!hasAllowlist && !hasRestricted) return null;

        const FactionChip = ({ faction, variant }: { faction: FactionDto; variant: 'allowed' | 'banned' | 'restricted' }) => (
          <Link
            key={faction.id}
            to="/factions/$id"
            params={{ id: faction.id }}
            className={[
              'flex items-center gap-1.5 rounded border px-2 py-1 hover:opacity-80 transition-opacity',
              variant === 'banned'
                ? 'bg-red-950/40 border-red-900/60'
                : variant === 'restricted'
                  ? 'bg-amber-950/40 border-amber-900/60'
                  : 'bg-stone-800 border-stone-700',
            ].join(' ')}
          >
            {faction.icon_url && (
              <img src={faction.icon_url} alt="" className="w-5 h-5 object-contain" />
            )}
            <span className={[
              'text-xs',
              variant === 'banned' ? 'text-red-300' : variant === 'restricted' ? 'text-amber-300' : 'text-stone-200',
            ].join(' ')}>{faction.name}</span>
          </Link>
        );

        return (
          <div className="mb-8 space-y-4">
            {hasAllowlist && allowedFactions.length > 0 && (
              <div>
                <h2 className="font-display text-base font-semibold text-rizzotto-gold-400 mb-3">
                  Allowed Factions
                </h2>
                <div className="flex flex-wrap gap-2">
                  {allowedFactions.map((faction) => (
                    <FactionChip key={faction.id} faction={faction} variant="allowed" />
                  ))}
                </div>
              </div>
            )}
            {hasBanned && (
              <div>
                <h2 className="font-display text-base font-semibold text-red-400 mb-3">
                  Banned Factions
                </h2>
                <div className="flex flex-wrap gap-2">
                  {bannedFactions.map((faction) => (
                    <FactionChip key={faction.id} faction={faction} variant="banned" />
                  ))}
                </div>
              </div>
            )}
            {hasRestricted && (
              <div>
                <h2 className="font-display text-base font-semibold text-amber-400 mb-3">
                  Restricted Factions{' '}
                  <span className="text-xs font-normal text-stone-500">(pickable but excluded from leaderboard)</span>
                </h2>
                <div className="flex flex-wrap gap-2">
                  {restrictedFactions.map((faction) => (
                    <FactionChip key={faction.id} faction={faction} variant="restricted" />
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {tournament.description && (
        <section className="mb-8">
          <h2 className="font-display text-xl font-semibold text-rizzotto-gold-500 mb-3">
            {t('tournament.detail.description')}
          </h2>
          <div className="text-stone-300 leading-relaxed">
            <SafeMarkdown>{tournament.description}</SafeMarkdown>
          </div>
        </section>
      )}

      {(tournament.standard_rules_enabled || tournament.rules || tournament.restrictions) && (
        <section className="mb-8">
          <h2 className="font-display text-xl font-semibold text-rizzotto-gold-500 mb-3">
            {t('tournament.detail.rules')}
          </h2>
          <div className="space-y-4">
            {tournament.standard_rules_enabled && <StandardRulesetCard />}
            {tournament.rules && (
              <div className="rounded-md border border-stone-800 bg-stone-900/50 p-6 text-stone-300 leading-relaxed">
                <SafeMarkdown>{tournament.rules}</SafeMarkdown>
              </div>
            )}
            {tournament.restrictions && (
              <div>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-rizzotto-gold-500/80">
                  Restrictions
                </h3>
                <div className="rounded-md border border-stone-800 bg-stone-900/50 p-6 text-stone-300 leading-relaxed">
                  <SafeMarkdown>{tournament.restrictions}</SafeMarkdown>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ─── Late-join requests (host-only, sits above whichever live view is shown) ─── */}
      {canManage && tournament.status === 'ONGOING' && tournament.allow_late_join_requests && (
        <LateJoinRequestsPanel slug={tournament.slug} />
      )}

      {/* ─── Participants or Standings ─── */}
      {tournament.status !== 'DRAFT' && (() => {
        const swiss = bracket?.swiss;
        const hasStandings = swiss && swiss.standings.length > 0;
        const isElim =
          tournament.format === 'SINGLE_ELIMINATION' ||
          tournament.format === 'DOUBLE_ELIMINATION';

        if (hasStandings) {
          return (
            <section className="mb-4">
              <SwissStandings
                standings={sortedStandings ?? swiss.standings}
                currentRound={swiss.currentRound}
                recommendedRounds={swiss.recommendedRounds}
                tournamentMode={tournament.mode}
                factionMap={standingsFactionMap}
                playerFactionMap={standingsPlayerFactionMap}
                playerFactionPoolMap={standingsPlayerFactionPoolMap}
                playoffFormat={tournament.playoff_format ?? undefined}
                finalistIds={standingsFinalistIds}
                semifinalistIds={standingsSemifinalistIds}
                tournamentSlug={tournament.slug}
                canManage={!!canManage}
                isCompleted={tournament.status === 'COMPLETED'}
                participantStatusMap={participantStatusMap}
                factionAllowlist={tournament.faction_allowlist}
              />
            </section>
          );
        }
        if (isElim && participantsData) {
          return (
            <EliminationStandings
              matches={bracket?.matches ?? []}
              participants={participantsData.data}
              slug={tournament.slug}
              canManage={!!canManage}
              tournamentStatus={tournament.status}
            />
          );
        }
        return <ParticipantsList slug={tournament.slug} canManage={!!canManage} tournamentStatus={tournament.status} tournamentMode={tournament.mode} />;
      })()}

      {/* ─── Game History link — below standings/participants ─── */}
      {(tournament.status === 'ONGOING' || tournament.status === 'COMPLETED') && (
        <div className="mb-6 flex justify-end">
          <Link
            to="/tournaments/$slug/games"
            params={{ slug: tournament.slug }}
            className="text-xs text-rizzotto-gold-400 hover:text-rizzotto-gold-300 transition-colors"
          >
            All games →
          </Link>
        </div>
      )}

      {/* ─── My Match (GameTiles) — only shown to participants during ongoing ─── */}
      {user && tournament.status === 'ONGOING' && bracket && participantsData && (
        <div id="my-match">
        <MyMatchSection
          currentUserId={user.id}
          matches={bracket.matches}
          playerNames={Object.fromEntries(
            participantsData.data.map((p) => [p.user.id, p.user.username]),
          )}
          tournamentSlug={tournament.slug}
          tournamentMode={tournament.mode}
        />
        </div>
      )}

      {/* ─── Bracket ─── */}
      {(tournament.status === 'ONGOING' || tournament.status === 'COMPLETED') && (
        <section className="relative left-1/2 w-[min(94vw,1600px)] -translate-x-1/2">
          <h2 className="font-display text-xl font-semibold text-rizzotto-gold-500 mb-3">
            {t('tournament.detail.bracket')}
          </h2>
          <BracketView
            slug={tournament.slug}
            tournamentId={tournament.id}
            canManage={!!canManage}
            hideStandings
            playoffFormat={tournament.playoff_format ?? 'NONE'}
            format={tournament.format}
          />
        </section>
      )}
    </PageShell>
  );
}
