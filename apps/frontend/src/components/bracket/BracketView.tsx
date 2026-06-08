import { useState, useRef, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import type { FactionDto } from '@rizzotto/types';
import { getBracket, getParticipants, startNextSwissRound, startPlayoffs, advancePlayoffs, getFactions, patchTournament } from '@/lib/api';
import { useLiveBracket } from '@/hooks/useLiveBracket';
import { computeBracketLayout } from './computeBracketLayout';
import { SVGBracket, type BracketPlayerInfo } from './SVGBracket';
import { MatchScoreModal } from './MatchScoreModal';
import { SwissStandings } from './SwissStandings';

interface BracketViewProps {
  slug: string;
  tournamentId: string;
  canManage?: boolean;
  hideStandings?: boolean;
  playoffFormat?: 'NONE' | 'TOP4' | 'TOP8' | null;
}

export function BracketView({ slug, tournamentId, canManage = false, hideStandings = false, playoffFormat }: BracketViewProps) {
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const transformRef = useRef<ReactZoomPanPinchRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['bracket', slug],
    queryFn: () => getBracket(slug),
    enabled: !!slug,
  });

  // Same query key as ParticipantsList — shares the cache. Used to resolve
  // player ids to usernames inside the bracket nodes.
  const { data: participantsData } = useQuery({
    queryKey: ['tournament-participants', slug],
    queryFn: () => getParticipants(slug),
    enabled: !!slug,
  });

  // Faction lookup — shared with SVGBracket (node logos) and SwissStandings.
  const { data: factionsData } = useQuery({
    queryKey: ['factions'],
    queryFn: () => getFactions(),
    staleTime: 60 * 60_000,
  });
  const factionMap = new Map<string, FactionDto>(
    (factionsData?.data ?? []).map((f) => [f.faction.id, f.faction]),
  );

  // Faction per player derived from match nodes (backend already applied 3-level fallback
  // including TournamentParticipant). Used as fallback when SwissStandingEntry.factionId is null.
  const playerFactionMap = new Map<string, string>();
  for (const m of data?.matches ?? []) {
    if (m.player1Id && m.player1FactionId && !playerFactionMap.has(m.player1Id)) {
      playerFactionMap.set(m.player1Id, m.player1FactionId);
    }
    if (m.player2Id && m.player2FactionId && !playerFactionMap.has(m.player2Id)) {
      playerFactionMap.set(m.player2Id, m.player2FactionId);
    }
  }

  // Players in the Grand Final match — used for the "→ Grand Final" divider in Standings.
  const finalistIds = new Set(
    data?.matches
      .filter((m) => m.phase === 'PLAYOFF_FINAL')
      .flatMap((m) => [m.player1Id, m.player2Id].filter((id): id is string => id !== null)) ?? [],
  );

  // Re-sort Swiss standings by playoff result once playoff matches are complete.
  // Without this, players are ordered by Swiss score — 3rd-place participants with
  // a better Swiss record would appear above the Grand Finalists.
  const sortedStandings = useMemo(() => {
    const base = data?.swiss?.standings;
    if (!base || !data) return base;

    const gfMatch = data.matches.find((m) => m.phase === 'PLAYOFF_FINAL');
    const tpMatch = data.matches.find((m) => m.phase === 'PLAYOFF_THIRD_PLACE');
    if (!gfMatch && !tpMatch) return base;

    // Build ordered playoff participant list: winner before loser when match is done.
    const playoffOrder: string[] = [];
    const push = (match: typeof gfMatch) => {
      if (!match) return;
      if (match.status === 'COMPLETED' && match.winnerId) {
        const loser = match.player1Id === match.winnerId ? match.player2Id : match.player1Id;
        if (match.winnerId) playoffOrder.push(match.winnerId);
        if (loser) playoffOrder.push(loser);
      } else {
        if (match.player1Id) playoffOrder.push(match.player1Id);
        if (match.player2Id) playoffOrder.push(match.player2Id);
      }
    };
    push(gfMatch);
    push(tpMatch);

    const orderedSet = new Set(playoffOrder);
    const top = playoffOrder
      .map((id) => base.find((s) => s.userId === id))
      .filter((s): s is NonNullable<typeof s> => s != null);
    const rest = base.filter((s) => !orderedSet.has(s.userId));
    return [...top, ...rest];
  }, [data?.swiss?.standings, data?.matches]);

  // Auto-fit: center and scale the bracket to fill the container whenever
  // the layout dimensions change (initial load or new round added).
  const layout = data && data.matches.length > 0 ? computeBracketLayout(data.matches) : null;
  useEffect(() => {
    if (!transformRef.current || !containerRef.current || !layout) return;
    const containerW = containerRef.current.clientWidth;
    const containerH = containerRef.current.clientHeight;
    const PAD = 20;
    const svgW = layout.width + PAD * 2;
    const svgH = layout.height + PAD * 2;
    const fitted = Math.min(containerW / svgW, containerH / svgH);
    transformRef.current.centerView(fitted, 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout?.width, layout?.height]);

  useLiveBracket(tournamentId);

  const {
    mutate: doNextRound,
    isPending: isStartingRound,
    error: nextRoundError,
  } = useMutation({
    mutationFn: () => startNextSwissRound(tournamentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bracket'] });
    },
  });

  const {
    mutate: doStartPlayoffs,
    isPending: isStartingPlayoffs,
    error: startPlayoffsError,
  } = useMutation({
    mutationFn: () => startPlayoffs(tournamentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bracket'] });
    },
  });

  const {
    mutate: doAdvancePlayoffs,
    isPending: isAdvancingPlayoffs,
    error: advancePlayoffsError,
  } = useMutation({
    mutationFn: () => advancePlayoffs(tournamentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bracket'] });
    },
  });

  const {
    mutate: doComplete,
    isPending: isCompleting,
    error: completeError,
  } = useMutation({
    mutationFn: () => patchTournament(slug, { status: 'COMPLETED' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bracket', slug] });
      void queryClient.invalidateQueries({ queryKey: ['tournament', slug] });
      void queryClient.invalidateQueries({ queryKey: ['tournaments'] });
    },
  });

  if (isLoading) {
    return <div className="text-stone-400 text-sm py-6">Loading bracket…</div>;
  }

  if (error || !data) {
    return (
      <div className="rounded-md border border-red-900 bg-red-950/40 p-4 text-red-300 text-sm">
        Bracket konnte nicht geladen werden.
      </div>
    );
  }

  if (data.matches.length === 0) {
    return <div className="text-stone-500 text-sm py-4">Noch keine Matches im Bracket.</div>;
  }

  const selectedMatch = selectedMatchId
    ? (data.matches.find((m) => m.matchId === selectedMatchId) ?? null)
    : null;

  const players = new Map<string, BracketPlayerInfo>(
    (participantsData?.data ?? []).map((p) => [
      p.user.id,
      { name: p.user.username, avatarUrl: p.user.avatar_url },
    ]),
  );

  const swiss = data.swiss;
  const showNextRoundButton =
    canManage && swiss !== undefined && swiss.currentRound < swiss.recommendedRounds;

  // Show "Advance to Playoffs" after last Swiss round is fully complete and playoffs not yet generated.
  const hasPlayoffMatches = swiss !== undefined && data.matches.some((m) => m.round > swiss.recommendedRounds);
  const lastSwissRoundDone =
    swiss !== undefined &&
    swiss.currentRound >= swiss.recommendedRounds &&
    data.matches
      .filter((m) => m.round === swiss.recommendedRounds)
      .every((m) => m.status === 'COMPLETED' || m.status === 'BYE');
  const showAdvanceToPlayoffs =
    canManage &&
    playoffFormat &&
    playoffFormat !== 'NONE' &&
    lastSwissRoundDone &&
    !hasPlayoffMatches;
  const advanceLabel =
    playoffFormat === 'TOP8' ? 'Advance to Quarterfinals' : 'Advance to Semifinals';

  // Advance to next playoff round (QF→SF or SF→Final): shown when current playoff
  // round is fully done and no Final match exists yet.
  const playoffPhases = data.matches.filter((m) => m.phase?.startsWith('PLAYOFF'));
  const hasFinalMatch = playoffPhases.some((m) => m.phase === 'PLAYOFF_FINAL');
  const lastPlayoffRound = playoffPhases.length > 0 ? Math.max(...playoffPhases.map((m) => m.round)) : 0;
  const lastPlayoffRoundDone =
    playoffPhases.length > 0 &&
    playoffPhases
      .filter((m) => m.round === lastPlayoffRound)
      .every((m) => m.status === 'COMPLETED' || m.status === 'BYE' || m.status === 'FORFEIT');
  const currentPlayoffPhase = playoffPhases.find((m) => m.round === lastPlayoffRound)?.phase ?? null;
  const nextPlayoffLabel = currentPlayoffPhase === 'PLAYOFF_QF' ? 'Advance to Semifinals' : 'Advance to Grand Final';
  const showAdvanceToNextPlayoffRound =
    canManage && hasPlayoffMatches && lastPlayoffRoundDone && !hasFinalMatch;

  const isDE = data.matches.some((m) => m.bracketSide !== null);
  const allDone = data.matches.every(
    (m) => m.status === 'COMPLETED' || m.status === 'BYE' || m.status === 'FORFEIT',
  );
  const showCompleteButton =
    canManage && allDone && !showNextRoundButton && !showAdvanceToPlayoffs && !showAdvanceToNextPlayoffRound;

  return (
    <div>
      {/* DE completion banner — shown when all matches are done */}
      {isDE && allDone && (
        <div className="mb-4 rounded border border-rizzotto-gold-500/60 bg-rizzotto-gold-500/10 px-4 py-3 text-sm font-medium text-rizzotto-gold-400">
          Grand Final abgeschlossen — Turnier entschieden
        </div>
      )}

      {/* Swiss Standings — suppressed when parent already renders them */}
      {swiss && !hideStandings && (
        <SwissStandings
          standings={sortedStandings ?? swiss.standings}
          currentRound={swiss.currentRound}
          recommendedRounds={swiss.recommendedRounds}
          factionMap={factionMap}
          playerFactionMap={playerFactionMap}
          tournamentMode={data.mode}
          playoffFormat={playoffFormat}
          finalistIds={finalistIds}
        />
      )}

      {/* Next Swiss Round button — organizer only */}
      {showNextRoundButton && (
        <div className="mb-4">
          {nextRoundError && (
            <p className="mb-2 text-sm text-red-400">Error: {(nextRoundError as Error).message}</p>
          )}
          <button
            type="button"
            onClick={() => doNextRound()}
            disabled={isStartingRound}
            className="rounded border border-rizzotto-gold-500/60 px-4 py-2 text-sm font-medium text-rizzotto-gold-500 hover:bg-rizzotto-gold-500/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isStartingRound ? 'Starting…' : 'Start next round'}
          </button>
        </div>
      )}

      {/* Advance to Playoffs button — shown only after all Swiss rounds are complete */}
      {showAdvanceToPlayoffs && (
        <div className="mb-4">
          {startPlayoffsError && (
            <p className="mb-2 text-sm text-red-400">Error: {(startPlayoffsError as Error).message}</p>
          )}
          <button
            type="button"
            onClick={() => doStartPlayoffs()}
            disabled={isStartingPlayoffs}
            className="rounded border border-rizzotto-gold-500/60 px-4 py-2 text-sm font-medium text-rizzotto-gold-500 hover:bg-rizzotto-gold-500/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isStartingPlayoffs ? 'Starting…' : advanceLabel}
          </button>
        </div>
      )}

      {/* Advance to next playoff round (QF→SF or SF→Grand Final) */}
      {showAdvanceToNextPlayoffRound && (
        <div className="mb-4">
          {advancePlayoffsError && (
            <p className="mb-2 text-sm text-red-400">Error: {(advancePlayoffsError as Error).message}</p>
          )}
          <button
            type="button"
            onClick={() => doAdvancePlayoffs()}
            disabled={isAdvancingPlayoffs}
            className="rounded border border-rizzotto-gold-500/60 px-4 py-2 text-sm font-medium text-rizzotto-gold-500 hover:bg-rizzotto-gold-500/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isAdvancingPlayoffs ? 'Starting…' : nextPlayoffLabel}
          </button>
        </div>
      )}

      {/* Complete Tournament button — shown when all matches are done */}
      {showCompleteButton && (
        <div className="mb-4">
          {completeError && (
            <p className="mb-2 text-sm text-red-400">Error: {(completeError as Error).message}</p>
          )}
          <button
            type="button"
            onClick={() => {
              if (confirm('Finalise tournament? Placements will be calculated. This cannot be undone.')) {
                doComplete();
              }
            }}
            disabled={isCompleting}
            className="rounded border border-rizzotto-gold-500/60 px-4 py-2 text-sm font-medium text-rizzotto-gold-500 hover:bg-rizzotto-gold-500/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isCompleting ? 'Finalising…' : 'Complete Tournament'}
          </button>
        </div>
      )}

      <div ref={containerRef} className="relative w-full overflow-hidden rounded-md border border-stone-800 bg-stone-950">
        <TransformWrapper
          ref={transformRef}
          minScale={0.3}
          maxScale={2}
          initialScale={1}
          limitToBounds={false}
          wheel={{ step: 0.1, activationKeys: ['Control'] }}
        >
          {({ zoomIn, zoomOut, resetTransform }) => (
            <>
              {/* Zoom controls — always visible for pan/zoom capable container */}
              <div className="absolute right-3 top-3 z-10 flex gap-1.5">
                <button
                  type="button"
                  onClick={() => zoomIn()}
                  aria-label="Zoom in"
                  className="rounded bg-stone-800 px-2 py-1 text-xs text-stone-200 hover:bg-stone-700 transition-colors select-none"
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={() => zoomOut()}
                  aria-label="Zoom out"
                  className="rounded bg-stone-800 px-2 py-1 text-xs text-stone-200 hover:bg-stone-700 transition-colors select-none"
                >
                  −
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!transformRef.current || !containerRef.current || !layout) {
                      resetTransform();
                      return;
                    }
                    const containerW = containerRef.current.clientWidth;
                    const containerH = containerRef.current.clientHeight;
                    const PAD = 20;
                    const svgW = layout.width + PAD * 2;
                    const svgH = layout.height + PAD * 2;
                    const fitted = Math.min(containerW / svgW, containerH / svgH);
                    transformRef.current.centerView(fitted, 200);
                  }}
                  aria-label="Reset zoom"
                  className="rounded bg-stone-800 px-2 py-1 text-xs text-stone-200 hover:bg-stone-700 transition-colors select-none"
                >
                  ⟲
                </button>
              </div>

              <TransformComponent
                wrapperStyle={{ width: '100%', height: 'max(480px, 70vh)' }}
                contentStyle={{ padding: '16px' }}
              >
                <SVGBracket
                  data={data}
                  players={players}
                  factionMap={factionMap}
                  tournamentMode={data.mode}
                  onMatchClick={(matchId) => {
                    const m = data.matches.find((x) => x.matchId === matchId);
                    if (canManage && m?.status !== 'BYE' && m?.status !== 'FORFEIT') {
                      setSelectedMatchId(matchId);
                    }
                  }}
                />
              </TransformComponent>
            </>
          )}
        </TransformWrapper>

        {selectedMatch && (() => {
          const p1GameWins = selectedMatch.player1GameWins;
          const p2GameWins = selectedMatch.player2GameWins;
          const hasGameWins = p1GameWins > 0 || p2GameWins > 0;
          const scoreParts = selectedMatch.score?.split('-');
          const initP1 = hasGameWins ? p1GameWins : Number(scoreParts?.[0] ?? 0);
          const initP2 = hasGameWins ? p2GameWins : Number(scoreParts?.[1] ?? 0);
          return (
            <MatchScoreModal
              matchId={selectedMatch.matchId}
              matchStatus={selectedMatch.status}
              matchFormat={selectedMatch.matchFormat}
              tournamentSlug={slug}
              player1Id={selectedMatch.player1Id}
              player2Id={selectedMatch.player2Id}
              initialWinnerId={selectedMatch.winnerId}
              initialP1Score={initP1}
              initialP2Score={initP2}
              initialMapId={selectedMatch.pickedMapId ?? undefined}
              initialP1FactionId={selectedMatch.player1FactionId ?? undefined}
              initialP2FactionId={selectedMatch.player2FactionId ?? undefined}
              player1Name={
                selectedMatch.player1Id ? players.get(selectedMatch.player1Id)?.name : undefined
              }
              player2Name={
                selectedMatch.player2Id ? players.get(selectedMatch.player2Id)?.name : undefined
              }
              onClose={() => setSelectedMatchId(null)}
            />
          );
        })()}
      </div>
    </div>
  );
}
