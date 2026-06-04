import { useQuery } from '@tanstack/react-query';
import { getMatchGames, getTournamentMaps } from '@/lib/api';
import type { MapDto } from '@/lib/api';
import type { BracketNode } from '@rizzotto/types';
import { useMatchDecisionSocket } from '@/hooks/useMatchDecisionSocket';
import { GameTile } from './GameTile';

interface Props {
  /** Current user's id */
  currentUserId: string;
  /** All matches from the bracket response */
  matches: BracketNode[];
  /** Player id → display name lookup */
  playerNames: Record<string, string>;
  /** Tournament slug — used to load the map pool for name resolution */
  tournamentSlug: string;
}

/**
 * Shows the current user's active match tile(s) above the Bracket.
 * Only renders when the user has a PENDING or ONGOING match in the tournament.
 */
export function MyMatchSection({ currentUserId, matches, playerNames, tournamentSlug }: Props) {
  const myMatch = matches.find(
    (m) =>
      (m.status === 'PENDING' || m.status === 'ONGOING') &&
      (m.player1Id === currentUserId || m.player2Id === currentUserId),
  );

  if (!myMatch) return null;

  return (
    <MyMatchInner
      match={myMatch}
      currentUserId={currentUserId}
      playerNames={playerNames}
      tournamentSlug={tournamentSlug}
    />
  );
}

function MyMatchInner({
  match,
  currentUserId,
  playerNames,
  tournamentSlug,
}: {
  match: BracketNode;
  currentUserId: string;
  playerNames: Record<string, string>;
  tournamentSlug: string;
}) {
  useMatchDecisionSocket(match.matchId);

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

  const p1Name = (match.player1Id && playerNames[match.player1Id]) ?? 'Player 1';
  const p2Name = (match.player2Id && playerNames[match.player2Id]) ?? 'Player 2';

  return (
    <section className="mb-6">
      <div className="flex items-center gap-3 mb-3">
        <h2 className="font-display text-lg font-semibold text-rizzotto-stone-200">
          Your Match
        </h2>
        <span className="text-xs text-rizzotto-stone-500">
          Round {match.round} · {p1Name} vs {p2Name}
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
              isParticipant={true}
              maps={maps}
            />
          ))}
        </div>
      )}
    </section>
  );
}
