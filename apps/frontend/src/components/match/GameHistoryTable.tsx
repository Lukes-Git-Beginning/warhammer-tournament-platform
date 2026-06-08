import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { getFactions } from '@/lib/api';
import type { GameHistoryEntry } from '@rizzotto/types';
import { formatInUserTimezone } from '@/lib/timezone';

interface Props {
  games: GameHistoryEntry[];
  showTournament?: boolean;
}

function FactionChip({ factionId, factionMap }: {
  factionId: string | null;
  factionMap: Map<string, { name: string; color_hex: string | null; icon_url: string | null }>;
}) {
  if (!factionId) return <span className="text-stone-600">—</span>;
  const f = factionMap.get(factionId);
  if (!f) return <span className="text-stone-500 text-xs">{factionId.slice(0, 8)}</span>;
  return (
    <span className="inline-flex items-center gap-1">
      {f.icon_url
        ? <img src={f.icon_url} alt={f.name} className="w-4 h-4 object-contain" />
        : <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: f.color_hex ?? '#555' }} />
      }
      <span className="text-xs text-stone-300">{f.name}</span>
    </span>
  );
}

export function GameHistoryTable({ games, showTournament = false }: Props) {
  const { data: factionData } = useQuery({
    queryKey: ['factions'],
    queryFn: () => getFactions(),
    staleTime: 60 * 60_000,
  });

  const factionMap = new Map(
    (factionData?.data ?? []).map((e) => [e.faction.id, e.faction]),
  );

  if (games.length === 0) {
    return <p className="text-stone-500 text-sm py-4">No games played yet.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border border-stone-800">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-stone-800 bg-stone-900/60">
            {showTournament && (
              <th className="px-3 py-2 text-left font-medium text-stone-400">Tournament</th>
            )}
            <th className="px-3 py-2 text-left font-medium text-stone-400">Date</th>
            <th className="px-3 py-2 text-center font-medium text-stone-400">Round</th>
            <th className="px-3 py-2 text-left font-medium text-stone-400">Player 1</th>
            <th className="px-3 py-2 text-left font-medium text-stone-400">Faction</th>
            <th className="px-3 py-2 text-left font-medium text-stone-400">Player 2</th>
            <th className="px-3 py-2 text-left font-medium text-stone-400">Faction</th>
            <th className="px-3 py-2 text-left font-medium text-stone-400">Map</th>
            <th className="px-3 py-2 text-left font-medium text-stone-400">Winner</th>
            <th className="px-3 py-2 text-left font-medium text-stone-400">Replay</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-800/60">
          {games.map((g) => {
            const p1Won = g.winnerId === g.player1?.id;
            const p2Won = g.winnerId === g.player2?.id;
            const unofficial = g.countsForLeaderboard === false;
            return (
              <tr key={g.id} className={`hover:bg-stone-800/30 transition-colors${unofficial ? ' opacity-40' : ''}`}>
                {showTournament && g.tournament && (
                  <td className="px-3 py-2">
                    <Link
                      to="/tournaments/$slug"
                      params={{ slug: g.tournament.slug }}
                      className="text-rizzotto-gold-400 hover:underline text-xs"
                    >
                      {g.tournament.name}
                    </Link>
                  </td>
                )}
                <td className="px-3 py-2 text-stone-500 text-xs whitespace-nowrap">
                  {g.playedAt ? formatInUserTimezone(g.playedAt) : '—'}
                </td>
                <td className="px-3 py-2 text-center text-stone-400 text-xs">
                  R{g.round}·G{g.gameNumber}
                </td>
                <td className={`px-3 py-2 font-medium ${p1Won ? 'text-rizzotto-gold-400' : 'text-stone-300'}`}>
                  {g.player1?.username ?? '—'}
                  {p1Won && <span className="ml-1 text-rizzotto-gold-500">✓</span>}
                </td>
                <td className="px-3 py-2">
                  <FactionChip factionId={g.player1FactionId} factionMap={factionMap} />
                </td>
                <td className={`px-3 py-2 font-medium ${p2Won ? 'text-rizzotto-gold-400' : 'text-stone-300'}`}>
                  {g.player2?.username ?? '—'}
                  {p2Won && <span className="ml-1 text-rizzotto-gold-500">✓</span>}
                </td>
                <td className="px-3 py-2">
                  <FactionChip factionId={g.player2FactionId} factionMap={factionMap} />
                </td>
                <td className="px-3 py-2 text-stone-400 text-xs">
                  {g.mapName ?? '—'}
                </td>
                <td className="px-3 py-2 text-stone-300 text-xs">
                  {g.winnerId
                    ? (g.player1?.id === g.winnerId ? g.player1?.username : g.player2?.username) ?? '—'
                    : '—'}
                </td>
                <td className="px-3 py-2">
                  {g.replayUrl
                    ? <a href={g.replayUrl} download className="text-rizzotto-gold-400 hover:text-rizzotto-gold-300 text-xs underline">Download</a>
                    : <span className="text-stone-600 text-xs">—</span>
                  }
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
