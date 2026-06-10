import { useState } from 'react';
import { useParams, Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getMatchDetail, getMatchDecision, getMatchScoringBreakdown, getMatchGames, getMaps, getFactions, type GameDto, type MapDto } from '@/lib/api.js';
import type { MatchDetailDto, MatchScoringBreakdownDto } from '@/lib/api.js';
import type { FactionDto } from '@rizzotto/types';
import { useAuthQuery } from '@/lib/auth.js';
import { useLiveMatch } from '@/hooks/useLiveMatch.js';
import { useMatchDecisionSocket } from '@/hooks/useMatchDecisionSocket.js';
import { PageShell } from '@/components/layout/PageShell.js';
import { Button } from '@/components/ui/button.js';
import { MatchScoreModal } from '@/components/bracket/MatchScoreModal.js';
import { GameTile } from '@/components/match/GameTile.js';

// ---------------------------------------------------------------------------
// Status Badge
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-rizzotto-iron-700 text-rizzotto-stone-400',
  ONGOING: 'bg-rizzotto-gold-500/20 text-rizzotto-gold-400 border border-rizzotto-gold-500/40',
  COMPLETED: 'bg-rizzotto-iron-700 text-rizzotto-stone-300',
  BYE: 'bg-rizzotto-iron-700 text-rizzotto-stone-400',
  FORFEIT: 'bg-red-900/40 text-red-300',
  DISPUTED: 'bg-orange-900/40 text-orange-300',
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLES[status] ?? 'bg-rizzotto-iron-700 text-rizzotto-stone-400';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wider uppercase ${cls}`}
    >
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Player Avatar — inline fallback-initials when avatar_url is null
// ---------------------------------------------------------------------------

function PlayerAvatar({ username, avatarUrl }: { username: string; avatarUrl: string | null }) {
  const initials = username.slice(0, 2).toUpperCase();
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={username}
        className="h-10 w-10 rounded-full object-cover ring-1 ring-rizzotto-iron-600 shrink-0"
        loading="lazy"
        decoding="async"
      />
    );
  }
  return (
    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rizzotto-iron-700 text-sm font-bold text-rizzotto-stone-300 ring-1 ring-rizzotto-iron-600 select-none">
      {initials}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Faction Chip — uses icon_url when available; falls back to name initials.
// FactionBadge requires color_hex + initials which MatchFactionRef doesn't
// carry, so we render a lightweight inline chip here.
// ---------------------------------------------------------------------------

function FactionChip({ faction }: { faction: MatchDetailDto['player1_faction'] }) {
  if (!faction) return <span className="text-rizzotto-stone-500 text-xs">—</span>;

  if (faction.icon_url) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <img
          src={faction.icon_url}
          alt={faction.name}
          className="h-5 w-5 rounded-full object-cover"
          loading="lazy"
          decoding="async"
        />
        <span className="text-xs text-rizzotto-stone-300">{faction.name}</span>
      </span>
    );
  }

  const initials = faction.name
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase()
    .slice(0, 3);

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rizzotto-iron-600 text-[9px] font-bold text-rizzotto-stone-200 select-none">
        {initials}
      </span>
      <span className="text-xs text-rizzotto-stone-300">{faction.name}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Phase / bracket side label
// ---------------------------------------------------------------------------

const PHASE_LABELS: Record<string, string> = {
  GROUP_STAGE: 'Group Stage',
  SWISS: 'Swiss',
  PLAYOFF_QF: 'Quarter-Final',
  PLAYOFF_SF: 'Semi-Final',
  PLAYOFF_FINAL: 'Grand Final',
};

const BRACKET_LABELS: Record<string, string> = {
  WINNERS: 'Winners Bracket',
  LOSERS: 'Losers Bracket',
  GRAND_FINAL: 'Grand Final',
};

function phaseLabel(match: MatchDetailDto): string | null {
  if (match.phase != null && PHASE_LABELS[match.phase]) return PHASE_LABELS[match.phase] ?? null;
  if (match.bracket_side != null && BRACKET_LABELS[match.bracket_side])
    return BRACKET_LABELS[match.bracket_side] ?? null;
  return null;
}

// ---------------------------------------------------------------------------
// Result label
// ---------------------------------------------------------------------------

function resultLabel(result: MatchDetailDto['result']): string {
  if (!result) return '—';
  switch (result) {
    case 'PLAYER1_WIN':
      return 'Player 1 Win';
    case 'PLAYER2_WIN':
      return 'Player 2 Win';
    case 'DRAW':
      return 'Draw';
    case 'DOUBLE_LOSS':
      return 'Double Loss';
  }
}

// ---------------------------------------------------------------------------
// Scoring Breakdown Widget
// ---------------------------------------------------------------------------

function ScoringBreakdownWidget({ breakdown }: { breakdown: MatchScoringBreakdownDto }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-rizzotto-iron-600 bg-rizzotto-iron-900/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-3 text-left"
      >
        <span className="text-xs font-semibold uppercase tracking-widest text-rizzotto-stone-400">
          Leaderboard Scoring Breakdown
        </span>
        <span className="text-rizzotto-stone-500 text-sm select-none">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="border-t border-rizzotto-iron-700 px-5 py-4 space-y-3">
          <p className="text-xs text-rizzotto-stone-500">
            How this match contributed to the dynamic leaderboard score.
          </p>

          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
            <div className="text-rizzotto-stone-500">Winner</div>
            <div className="text-rizzotto-stone-200 font-medium">{breakdown.winner.username}</div>

            <div className="text-rizzotto-stone-500">Winner Faction</div>
            <div className="text-rizzotto-stone-200">{breakdown.winnerFaction}</div>

            <div className="text-rizzotto-stone-500">Loser</div>
            <div className="text-rizzotto-stone-200">{breakdown.loser.username}</div>

            <div className="text-rizzotto-stone-500">Loser Faction</div>
            <div className="text-rizzotto-stone-200">{breakdown.loserFaction}</div>

            <div className="text-rizzotto-stone-500">Expected Win Chance</div>
            <div className="text-rizzotto-stone-200">
              {(breakdown.expectedChanceToWin * 100).toFixed(1)}%
            </div>

            <div className="text-rizzotto-stone-500">Raw Points</div>
            <div className="text-rizzotto-stone-200">{breakdown.rawPoints.toFixed(2)}</div>

            <div className="text-rizzotto-stone-500">Opponent Modifier</div>
            <div className="text-rizzotto-stone-200">{breakdown.opponentModifier.toFixed(3)}</div>

            <div className="text-rizzotto-stone-500 font-semibold">Final Points Awarded</div>
            <div className="text-rizzotto-gold-400 font-bold">
              {breakdown.finalPoints.toFixed(2)}
            </div>
          </div>

          <p className="text-[10px] text-rizzotto-stone-600 pt-1">
            Faction skill, matchup effect and opponent modifier are factored in by the
            L2-Logistic-Regression model.
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function MatchDetailPage() {
  const { matchId } = useParams({ from: '/matches/$matchId' });
  const queryClient = useQueryClient();

  const [showScoreModal, setShowScoreModal] = useState(false);

  // Auth — optional; only used for permission gate on Report button
  const { data: user } = useAuthQuery();

  // Match detail — primary data source
  const {
    data: match,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['match', matchId],
    queryFn: () => getMatchDetail(matchId),
    retry: false,
    // Open Play has no tournament socket room, so poll until the match settles
    refetchInterval: (query) =>
      query.state.data?.tournament_id || query.state.data?.status === 'COMPLETED'
        ? false
        : 5_000,
  });

  // Decision gate — keep existing behaviour
  const { data: decision } = useQuery({
    queryKey: ['match-decision', matchId],
    queryFn: () => getMatchDecision(matchId),
    retry: false,
  });

  // Scoring breakdown — only fetched when match is completed
  const { data: breakdown } = useQuery({
    queryKey: ['match-scoring-breakdown', matchId],
    queryFn: () => getMatchScoringBreakdown(matchId),
    enabled: match?.status === 'COMPLETED',
    retry: false,
  });

  const isOpenPlay = !!match && !match.tournament_id;

  const { data: gamesData } = useQuery({
    queryKey: ['match-games', matchId],
    queryFn: () => getMatchGames(matchId),
    enabled: isOpenPlay,
    refetchInterval: 5_000,
  });

  const { data: mapsData } = useQuery({
    queryKey: ['maps'],
    queryFn: getMaps,
    staleTime: 60 * 60_000,
    enabled: isOpenPlay,
  });

  const { data: factionsData } = useQuery({
    queryKey: ['factions'],
    queryFn: () => getFactions(),
    staleTime: 60 * 60_000,
    enabled: isOpenPlay,
  });

  const maps: MapDto[] = mapsData?.data ?? [];
  const factions: Record<string, FactionDto> = Object.fromEntries(
    (factionsData?.data ?? []).map((f) => [f.faction.id, f.faction]),
  );

  // Live Socket updates — joins tournament room, invalidates match queries
  useLiveMatch(matchId, match?.tournament_id);
  useMatchDecisionSocket(matchId);

  // ---------------------------------------------------------------------------
  // Loading / Error
  // ---------------------------------------------------------------------------

  if (isLoading) {
    return (
      <PageShell
        variant="tight"
        spacing="base"
        className="flex items-center justify-center min-h-[60vh]"
      >
        <div className="flex flex-col items-center gap-3">
          <span className="h-8 w-8 rounded-full border-2 border-rizzotto-gold-400 border-t-transparent animate-spin" />
          <p className="text-sm text-rizzotto-stone-400">Loading match…</p>
        </div>
      </PageShell>
    );
  }

  if (error || !match) {
    return (
      <PageShell variant="tight" spacing="base">
        <div className="rounded-md border border-red-900 bg-red-950/40 p-6 text-red-300 text-sm">
          Match not found or unavailable.
        </div>
      </PageShell>
    );
  }

  // ---------------------------------------------------------------------------
  // Permission: can the current user report a result?
  // ---------------------------------------------------------------------------

  const isPlayer1 = user?.id === match.player1_id;
  const isPlayer2 = user?.id === match.player2_id;
  const isPrivileged =
    user?.role === 'ADMIN' || user?.role === 'MODERATOR' || user?.role === 'ORGANIZER';
  const canReport = !!(user && (isPlayer1 || isPlayer2 || isPrivileged));
  const reportable = match.status === 'ONGOING' || match.status === 'PENDING';

  // ---------------------------------------------------------------------------
  // Decision gate state
  // ---------------------------------------------------------------------------

  const decisionComplete = decision?.decidedAt != null;

  // ---------------------------------------------------------------------------
  // Phase label for header
  // ---------------------------------------------------------------------------

  const phase = phaseLabel(match);

  // Live per-game score for Open Play.
  // Uses winnerId for confirmed games; falls back to reportedWinnerId while
  // the result is in the 30-min provisional window (game not yet COMPLETED).
  // DISPUTED games are excluded so a contested result never inflates the score.
  const openPlayScore = isOpenPlay && gamesData ? (() => {
    const effectiveWinner = (g: { winnerId: string | null; reportedWinnerId: string | null; status: string }) =>
      g.winnerId ?? (g.status !== 'DISPUTED' ? g.reportedWinnerId : null);
    return {
      p1: gamesData.games.filter((g) => effectiveWinner(g) === match.player1_id).length,
      p2: gamesData.games.filter((g) => effectiveWinner(g) === match.player2_id).length,
    };
  })() : null;

  return (
    <PageShell variant="tight" spacing="base">
      {/* ------------------------------------------------------------------ */}
      {/* Header                                                               */}
      {/* ------------------------------------------------------------------ */}
      <div className="mb-6">
        {isOpenPlay ? (
          <Link to="/open-play" className="text-xs text-rizzotto-stone-500 hover:text-rizzotto-stone-300 transition-colors">
            ← Open Play
          </Link>
        ) : (
          <Link
            to="/tournaments/$slug"
            params={{ slug: match.tournament_slug }}
            className="text-xs text-rizzotto-stone-500 hover:text-rizzotto-stone-300 transition-colors"
          >
            ← Back to Tournament
          </Link>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-bold text-rizzotto-stone-100">
            {isOpenPlay ? 'Open Play Match' : `Round ${match.round} · Match #${match.match_number}`}
          </h1>
          {phase && (
            <span className="text-xs text-rizzotto-stone-500 uppercase tracking-widest font-semibold">
              {phase}
            </span>
          )}
          <StatusBadge status={match.status} />
        </div>

        <p className="text-xs text-rizzotto-stone-600 mt-0.5 tracking-widest uppercase">
          #{matchId.slice(-8)}
        </p>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Decision Gate (tournament matches only)                             */}
      {/* ------------------------------------------------------------------ */}
      {!isOpenPlay && !decisionComplete && decision !== undefined && (
        <div className="rounded-lg border border-rizzotto-gold-500/30 bg-rizzotto-gold-500/5 p-6 mb-6 flex flex-col items-center gap-4 text-center">
          <p className="text-sm text-rizzotto-stone-300">
            This match requires a map &amp; faction decision before it can begin.
          </p>
          <Button variant="forge" size="md" asChild>
            <Link to="/matches/$matchId/decision" params={{ matchId }}>
              Open Match Decision
            </Link>
          </Button>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Participants                                                         */}
      {/* ------------------------------------------------------------------ */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 rounded-xl border border-rizzotto-iron-600 bg-rizzotto-iron-900/80 p-6 mb-4">
        {/* Player 1 */}
        <div
          className={[
            'flex flex-col items-center gap-2 rounded-lg p-4 transition-colors',
            match.winner_id && match.winner_id === match.player1_id
              ? 'border border-rizzotto-gold-500/50 bg-rizzotto-gold-500/10'
              : 'border border-transparent',
          ].join(' ')}
        >
          {match.player1 ? (
            <>
              <PlayerAvatar
                username={match.player1.username}
                avatarUrl={match.player1.avatar_url}
              />
              <span
                className={[
                  'text-sm font-semibold',
                  match.winner_id === match.player1_id
                    ? 'text-rizzotto-gold-400'
                    : 'text-rizzotto-stone-200',
                ].join(' ')}
              >
                {match.player1.username}
              </span>
              {match.winner_id === match.player1_id && (
                <span className="text-[10px] font-bold uppercase tracking-widest text-rizzotto-gold-500">
                  Winner
                </span>
              )}
            </>
          ) : (
            <span className="text-rizzotto-stone-500 text-sm">TBD</span>
          )}

          <FactionChip faction={match.player1_faction} />

          {match.player1_points != null && (
            <span className="mt-1 text-2xl font-bold font-display text-rizzotto-stone-100">
              {match.player1_points}
            </span>
          )}
        </div>

        {/* VS divider */}
        <div className="flex flex-col items-center gap-2 px-2">
          <span className="font-display text-xl font-bold text-rizzotto-stone-600">vs</span>
          {openPlayScore && (openPlayScore.p1 > 0 || openPlayScore.p2 > 0) ? (
            <span className="text-2xl font-bold text-rizzotto-stone-100 font-display">
              {openPlayScore.p1} – {openPlayScore.p2}
            </span>
          ) : match.score ? (
            <span className="text-sm font-bold text-rizzotto-stone-300 font-display">
              {match.score}
            </span>
          ) : null}
          {match.result && (
            <span className="text-[10px] text-rizzotto-stone-500 uppercase tracking-widest text-center">
              {resultLabel(match.result)}
            </span>
          )}
        </div>

        {/* Player 2 */}
        <div
          className={[
            'flex flex-col items-center gap-2 rounded-lg p-4 transition-colors',
            match.winner_id && match.winner_id === match.player2_id
              ? 'border border-rizzotto-gold-500/50 bg-rizzotto-gold-500/10'
              : 'border border-transparent',
          ].join(' ')}
        >
          {match.player2 ? (
            <>
              <PlayerAvatar
                username={match.player2.username}
                avatarUrl={match.player2.avatar_url}
              />
              <span
                className={[
                  'text-sm font-semibold',
                  match.winner_id === match.player2_id
                    ? 'text-rizzotto-gold-400'
                    : 'text-rizzotto-stone-200',
                ].join(' ')}
              >
                {match.player2.username}
              </span>
              {match.winner_id === match.player2_id && (
                <span className="text-[10px] font-bold uppercase tracking-widest text-rizzotto-gold-500">
                  Winner
                </span>
              )}
            </>
          ) : (
            <span className="text-rizzotto-stone-500 text-sm">TBD</span>
          )}

          <FactionChip faction={match.player2_faction} />

          {match.player2_points != null && (
            <span className="mt-1 text-2xl font-bold font-display text-rizzotto-stone-100">
              {match.player2_points}
            </span>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Timing                                                               */}
      {/* ------------------------------------------------------------------ */}
      {(match.scheduled_time ?? match.played_at) && (
        <div className="flex gap-6 text-xs text-rizzotto-stone-500 mb-4">
          {match.scheduled_time && (
            <span>
              <span className="text-rizzotto-stone-600 uppercase tracking-widest mr-1">
                Scheduled:
              </span>
              {new Date(match.scheduled_time).toLocaleString()}
            </span>
          )}
          {match.played_at && (
            <span>
              <span className="text-rizzotto-stone-600 uppercase tracking-widest mr-1">
                Played:
              </span>
              {new Date(match.played_at).toLocaleString()}
            </span>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Post-decision summary (preserved from stub)                          */}
      {/* ------------------------------------------------------------------ */}
      {/* ------------------------------------------------------------------ */}
      {/* Open Play — GameTile section (map, blind pick, result reporting)    */}
      {/* ------------------------------------------------------------------ */}
      {isOpenPlay && gamesData && (
        <div className="flex flex-col gap-3 mb-6">
          {[...gamesData.games].reverse().map((game) => (
            <GameTile
              key={game.gameNumber}
              matchId={matchId}
              game={game}
              currentUserId={user?.id ?? ''}
              player1Id={match.player1_id}
              player2Id={match.player2_id}
              player1Name={match.player1?.username ?? 'Player 1'}
              player2Name={match.player2?.username ?? 'Player 2'}
              player1AvatarUrl={match.player1?.avatar_url ?? null}
              player2AvatarUrl={match.player2?.avatar_url ?? null}
              isParticipant={canReport}
              maps={maps}
              factions={factions}
            />
          ))}
        </div>
      )}

      {!isOpenPlay && decisionComplete && decision && (
        <div className="rounded-lg border border-rizzotto-iron-600 bg-rizzotto-iron-900 p-6 space-y-3 mb-4">
          <h2 className="font-display text-base font-semibold text-rizzotto-gold-400">
            Match Setup
          </h2>
          <div className="text-sm text-rizzotto-stone-300 space-y-1">
            <div>
              <span className="text-rizzotto-stone-500">Map:</span>{' '}
              <span className="text-rizzotto-stone-200 font-medium">
                {decision.pickedMapId ?? '—'}
              </span>
            </div>
            {decision.blindPick?.player1FactionId && (
              <div>
                <span className="text-rizzotto-stone-500">Player 1 Faction:</span>{' '}
                <span className="text-rizzotto-stone-200">
                  {decision.blindPick.player1FactionId}
                </span>
              </div>
            )}
            {decision.blindPick?.player2FactionId && (
              <div>
                <span className="text-rizzotto-stone-500">Player 2 Faction:</span>{' '}
                <span className="text-rizzotto-stone-200">
                  {decision.blindPick.player2FactionId}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Result Reporting                                                     */}
      {/* ------------------------------------------------------------------ */}
      {!isOpenPlay && canReport && reportable && (
        <div className="mb-4 flex justify-end">
          <Button variant="forge" size="md" onClick={() => setShowScoreModal(true)}>
            Report Result
          </Button>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Scoring Breakdown                                                    */}
      {/* ------------------------------------------------------------------ */}
      {breakdown && (
        <div className="mb-4">
          <ScoringBreakdownWidget breakdown={breakdown} />
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Score Modal                                                          */}
      {/* ------------------------------------------------------------------ */}
      {showScoreModal && (
        <MatchScoreModal
          matchId={matchId}
          player1Id={match.player1_id}
          player2Id={match.player2_id}
          player1Name={match.player1?.username}
          player2Name={match.player2?.username}
          onClose={() => {
            setShowScoreModal(false);
            // Ensure match detail is fresh after result is reported.
            // MatchScoreModal already invalidates ['bracket']; we additionally
            // refresh the match-level queries here.
            void queryClient.invalidateQueries({ queryKey: ['match', matchId] });
            void queryClient.invalidateQueries({ queryKey: ['match-scoring-breakdown', matchId] });
          }}
        />
      )}
    </PageShell>
  );
}
