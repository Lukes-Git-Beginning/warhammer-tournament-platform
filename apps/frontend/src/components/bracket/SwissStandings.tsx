import { Link } from '@tanstack/react-router';
import type { FactionDto, SwissMeta } from '@rizzotto/types';
import { FactionBadge } from '@/components/meta/FactionBadge';

interface SwissStandingsProps {
  standings: SwissMeta['standings'];
  currentRound: number;
  recommendedRounds: number;
  factionMap?: Map<string, FactionDto>;
  /** userId → factionId, derived from bracket matches as fallback */
  playerFactionMap?: Map<string, string>;
  /** Tournament mode — Faction column shown only for SFT (and future 2FT/3FT) */
  tournamentMode?: string;
}

function Avatar({ url, username }: { url: string | null; username: string }) {
  if (!url) {
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-stone-700 text-xs font-medium text-stone-200">
        {username[0]?.toUpperCase() ?? '?'}
      </span>
    );
  }
  return (
    <img
      src={url}
      alt={username}
      className="h-6 w-6 rounded-full border border-stone-700 object-cover"
    />
  );
}

const FACTION_MODES = new Set(['SFT', '2FT', 'DFT', '3FT', 'TFT']);

export function SwissStandings({
  standings,
  currentRound,
  recommendedRounds,
  factionMap,
  playerFactionMap,
  tournamentMode,
}: SwissStandingsProps) {
  const showFactionColumn = tournamentMode ? FACTION_MODES.has(tournamentMode) : false;
  return (
    <div className="mb-6 rounded-md border border-stone-800 bg-stone-900/40 overflow-hidden">
      <div className="px-4 py-3 border-b border-stone-800 bg-stone-900/60">
        <h3 className="font-display text-base font-semibold text-rizzotto-gold-500">
          Standings (Round {currentRound}/{recommendedRounds})
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-stone-800">
              <th className="px-4 py-2 text-left font-medium text-stone-400">#</th>
              <th className="px-4 py-2 text-left font-medium text-stone-400">Player</th>
              {showFactionColumn && <th className="px-4 py-2 text-left font-medium text-stone-400">Faction</th>}
              <th className="px-4 py-2 text-right font-medium text-stone-400">Score</th>
              <th className="px-4 py-2 text-center font-medium text-stone-400">W / L / B</th>
              <th className="px-4 py-2 text-right font-medium text-stone-400 tabular-nums" title="Games Lost">GL</th>
              <th className="px-4 py-2 text-right font-medium text-stone-400 tabular-nums" title="Buchholz">BH</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-800/60">
            {standings.map((entry, idx) => {
              const displayName = entry.username ?? entry.userId;
              const factionId = entry.factionId ?? playerFactionMap?.get(entry.userId);
              const faction = factionId ? factionMap?.get(factionId) : undefined;
              return (
                <tr key={entry.userId} className="hover:bg-stone-800/30 transition-colors">
                  <td className="px-4 py-2 text-stone-500">{idx + 1}</td>
                  <td className="px-4 py-2">
                    <Link
                      to="/users/$id"
                      params={{ id: entry.userId }}
                      className="flex items-center gap-2 hover:text-rizzotto-gold-500 transition-colors"
                    >
                      <Avatar url={entry.avatarUrl} username={displayName} />
                      <span className="text-stone-200">{displayName}</span>
                    </Link>
                  </td>
                  {showFactionColumn && (
                    <td className="px-4 py-2">
                      {faction ? (
                        <div className="flex items-center gap-2">
                          <FactionBadge
                            size="sm"
                            colorHex={faction.color_hex}
                            initials={faction.initials}
                            name={faction.name}
                            iconUrl={faction.icon_url}
                          />
                          <span className="text-xs text-stone-300">{faction.name}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-stone-600">—</span>
                      )}
                    </td>
                  )}
                  <td className="px-4 py-2 text-right font-semibold text-stone-100">
                    {entry.score}
                  </td>
                  <td className="px-4 py-2 text-center text-stone-300">
                    <span className="text-emerald-400">{entry.wins}</span>
                    <span className="text-stone-600"> / </span>
                    <span className="text-red-400">{entry.losses}</span>
                    <span className="text-stone-600"> / </span>
                    <span className="text-stone-400">{entry.byes}</span>
                  </td>
                  <td className="px-4 py-2 text-right text-stone-400 tabular-nums">{entry.gamesLost}</td>
                  <td className="px-4 py-2 text-right text-stone-500 tabular-nums text-xs">{entry.buchholz.toFixed(1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
