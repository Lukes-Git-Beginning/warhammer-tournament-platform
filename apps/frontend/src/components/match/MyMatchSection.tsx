import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getMatchGames, getTournamentMaps, getFactions, getParticipants, startMatchDecision } from '@/lib/api';
import type { MapDto } from '@/lib/api';
import type { BracketNode, FactionDto } from '@rizzotto/types';
import { useMatchDecisionSocket } from '@/hooks/useMatchDecisionSocket';
import { GameTile } from './GameTile';

function matchPhaseLabel(phase: BracketNode['phase'], round: number): string {
  if (phase === 'PLAYOFF_FINAL') return 'Grand Final';
  if (phase === 'PLAYOFF_SF') return 'Semifinal';
  if (phase === 'PLAYOFF_QF') return 'Quarterfinal';
  if (phase === 'PLAYOFF_THIRD_PLACE') return '3rd Place';
  return `Round ${round}`;
}

interface Props {
  /** Current user's id */
  currentUserId: string;
  /** All matches from the bracket response */
  matches: BracketNode[];
  /** Player id → display name lookup */
  playerNames: Record<string, string>;
  /** Tournament slug — used to load the map pool for name resolution */
  tournamentSlug: string;
  /** Tournament mode (e.g. 'BPT') — forwarded to GameTile for blind-pick logic */
  tournamentMode?: string;
}

/**
 * Shows the current user's active match tile(s) above the Bracket.
 * Only renders when the user has a PENDING or ONGOING match in the tournament.
 */
export function MyMatchSection({ currentUserId, matches, playerNames, tournamentSlug, tournamentMode }: Props) {
  const myMatch = matches.find(
    (m) =>
      (m.status === 'PENDING' || m.status === 'ONGOING') &&
      m.player1Id !== null &&
      m.player2Id !== null &&
      (m.player1Id === currentUserId || m.player2Id === currentUserId),
  );

  if (!myMatch) return null;

  return (
    <MyMatchInner
      match={myMatch}
      currentUserId={currentUserId}
      playerNames={playerNames}
      tournamentSlug={tournamentSlug}
      tournamentMode={tournamentMode}
    />
  );
}

function MyMatchInner({
  match,
  currentUserId,
  playerNames,
  tournamentSlug,
  tournamentMode,
}: {
  match: BracketNode;
  currentUserId: string;
  playerNames: Record<string, string>;
  tournamentSlug: string;
  tournamentMode?: string;
}) {
  useMatchDecisionSocket(match.matchId);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['match-games', match.matchId],
    queryFn: () => getMatchGames(match.matchId),
    refetchInterval: 30_000,
  });

  const { data: mapsData } = useQuery({
    queryKey: ['tournament-maps', tournamentSlug],
    queryFn: () => getTournamentMaps(tournamentSlug),
    staleTime: 5 * 60_000,
  });
  const maps: MapDto[] = mapsData?.data ?? [];

  const { data: factionsData } = useQuery({
    queryKey: ['factions'],
    queryFn: () => getFactions(),
    staleTime: 60 * 60_000,
  });
  const factions: Record<string, FactionDto> = Object.fromEntries(
    (factionsData?.data ?? []).map((f) => [f.faction.id, f.faction]),
  );

  // Reuses the cache populated by BracketView / ParticipantsList for avatar URLs.
  const { data: participantsData } = useQuery({
    queryKey: ['tournament-participants', tournamentSlug],
    queryFn: () => getParticipants(tournamentSlug),
    staleTime: 5 * 60_000,
  });
  const playerAvatars: Record<string, string | null> = Object.fromEntries(
    (participantsData?.data ?? []).map((p) => [p.user.id, p.user.avatar_url]),
  );

  const p1Name = (match.player1Id && playerNames[match.player1Id]) ?? 'Player 1';
  const p2Name = (match.player2Id && playerNames[match.player2Id]) ?? 'Player 2';

  return (
    <section className="mb-6">
      <div className="flex items-center gap-3 mb-3">
        <h2 className="font-display text-lg font-semibold text-rizzotto-stone-200">
          Your Match
        </h2>
        <span className="text-xs text-rizzotto-stone-500">
          {matchPhaseLabel(match.phase, match.round)} · {p1Name} vs {p2Name}
        </span>
      </div>

      {isLoading && (
        <div className="rounded-xl border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4 flex items-center justify-center">
          <span className="h-5 w-5 rounded-full border-2 border-rizzotto-gold-400 border-t-transparent animate-spin" />
        </div>
      )}

      {data && (
        <div className="flex flex-col gap-3">
          {data.games.map((game) => (
            <GameTile
              key={game.gameNumber}
              matchId={match.matchId}
              game={game}
              currentUserId={currentUserId}
              player1Id={match.player1Id}
              player2Id={match.player2Id}
              player1Name={p1Name}
              player2Name={p2Name}
              player1AvatarUrl={match.player1Id ? (playerAvatars[match.player1Id] ?? null) : null}
              player2AvatarUrl={match.player2Id ? (playerAvatars[match.player2Id] ?? null) : null}
              matchPlayer1FactionId={match.player1FactionId}
              matchPlayer2FactionId={match.player2FactionId}
              isParticipant={true}
              maps={maps}
              factions={factions}
              tournamentMode={tournamentMode}
            />
          ))}
          {(() => {
            const games = data.games;
            const lastGame = games[games.length - 1];
            const isParticipant =
              match.player1Id === currentUserId || match.player2Id === currentUserId;
            if (
              isParticipant &&
              match.status === 'ONGOING' &&
              lastGame?.status === 'COMPLETED' &&
              !games.some((g) => g.status === 'PENDING' || g.status === 'ONGOING')
            ) {
              const nextGameNumber = lastGame.gameNumber + 1;
              return (
                <button
                  type="button"
                  onClick={async () => {
                    await startMatchDecision(match.matchId, nextGameNumber);
                    queryClient.invalidateQueries({ queryKey: ['match-games', match.matchId] });
                  }}
                  className="rounded-md border border-rizzotto-gold-500 bg-rizzotto-gold-500/10 px-4 py-2 text-sm font-medium text-rizzotto-gold-300 hover:bg-rizzotto-gold-500/20 transition-colors"
                >
                  Start Game {nextGameNumber}
                </button>
              );
            }
            return null;
          })()}
        </div>
      )}
    </section>
  );
}
