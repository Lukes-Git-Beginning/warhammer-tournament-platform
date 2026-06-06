import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { getBracket, getParticipants, startNextSwissRound } from '@/lib/api';
import { useLiveBracket } from '@/hooks/useLiveBracket';
import { SVGBracket, type BracketPlayerInfo } from './SVGBracket';
import { MatchScoreModal } from './MatchScoreModal';
import { SwissStandings } from './SwissStandings';

interface BracketViewProps {
  slug: string;
  tournamentId: string;
  canManage?: boolean;
  hideStandings?: boolean;
}

export function BracketView({ slug, tournamentId, canManage = false, hideStandings = false }: BracketViewProps) {
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const queryClient = useQueryClient();

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

  if (isLoading) {
    return <div className="text-stone-400 text-sm py-6">Bracket wird geladen…</div>;
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

  const isDE = data.matches.some((m) => m.bracketSide !== null);
  const allDone = data.matches.every(
    (m) => m.status === 'COMPLETED' || m.status === 'BYE' || m.status === 'FORFEIT',
  );

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
          standings={swiss.standings}
          currentRound={swiss.currentRound}
          recommendedRounds={swiss.recommendedRounds}
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

      <div className="relative w-full overflow-hidden rounded-md border border-stone-800 bg-stone-950">
        <TransformWrapper
          minScale={0.3}
          maxScale={2}
          initialScale={data.matches.length > 32 ? 0.6 : 1}
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
                  onClick={() => resetTransform()}
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
              tournamentSlug={slug}
              player1Id={selectedMatch.player1Id}
              player2Id={selectedMatch.player2Id}
              initialWinnerId={selectedMatch.winnerId}
              initialP1Score={initP1}
              initialP2Score={initP2}
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
