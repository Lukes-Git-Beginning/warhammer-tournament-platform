import { Link } from '@tanstack/react-router';
import type { FactionDto, SwissMeta } from '@rizzotto/types';
import { FactionBadge } from '@/components/meta/FactionBadge';

const PLACEMENT_BADGE: Record<1 | 2 | 3 | 4, { label: string; className: string }> = {
  1: { label: '1ST', className: 'text-rizzotto-gold-400 border-rizzotto-gold-500/50 bg-rizzotto-gold-500/10' },
  2: { label: '2ND', className: 'text-stone-300 border-stone-500/40 bg-stone-700/20' },
  3: { label: '3RD', className: 'text-orange-500 border-orange-700/40 bg-orange-950/30' },
  4: { label: '4TH', className: 'text-stone-500 border-stone-700/40 bg-stone-900/20' },
};

interface SwissStandingsProps {
  standings: SwissMeta['standings'];
  currentRound: number;
  recommendedRounds: number;
  factionMap?: Map<string, FactionDto>;
  /** userId → factionId, derived from bracket matches as fallback */
  playerFactionMap?: Map<string, string>;
  /** Tournament mode — Faction column shown only for SFT (and future 2FT/3FT) */
  tournamentMode?: string;
  /** Playoff format — controls first-divider position */
  playoffFormat?: 'NONE' | 'TOP4' | 'TOP8' | null;
  /** Players who have advanced to the Grand Final (from PLAYOFF_FINAL match) */
  finalistIds?: Set<string>;
  /** Players who have qualified for the Semifinals (QF winners — TOP8 only) */
  semifinalistIds?: Set<string>;
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

function Divider({ label, colSpan }: { label: string; colSpan: number }) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className="px-4 py-1.5 bg-rizzotto-gold-500/5 border-y border-rizzotto-gold-500/20"
      >
        <span className="text-[10px] text-rizzotto-gold-500/70 uppercase tracking-widest font-semibold">
          ↑ {label}
        </span>
      </td>
    </tr>
  );
}

export function SwissStandings({
  standings,
  currentRound,
  recommendedRounds,
  factionMap,
  playerFactionMap,
  tournamentMode,
  playoffFormat,
  finalistIds,
  semifinalistIds,
}: SwissStandingsProps) {
  const showFactionColumn = tournamentMode ? FACTION_MODES.has(tournamentMode) : false;
  const colCount = 5 + (showFactionColumn ? 1 : 0) + 1; // # + Player + [Faction] + Score + W/L/B + GL + BH

  // Cap displayed round at the Swiss phase — don't count playoff rounds.
  const displayRound = Math.min(currentRound, recommendedRounds);

  // Divider thresholds — three possible dividers rendered from bottom to top:
  //   1. "Advance to Quarterfinals" (TOP8 only, before any QF is played)
  //   2. "Advance to Semifinals"   (TOP8: after QF winners known; TOP4: on playoff start)
  //   3. "Advance to Grand Final"  (after SF winners known)
  const playoffCutoff = playoffFormat === 'TOP8' ? 8 : playoffFormat === 'TOP4' ? 4 : 0;
  const playoffsStarted = playoffCutoff > 0 && currentRound >= recommendedRounds;

  const isTop8 = playoffFormat === 'TOP8';
  const sfCount = semifinalistIds?.size ?? 0;

  // QF divider: TOP8 only, shown until the first QF winner is known
  const showQFDivider = isTop8 && playoffsStarted && sfCount === 0;

  // SF divider:
  //   TOP4 — shown once playoffs start (until SF winners emerge)
  //   TOP8 — shown once ≥1 QF winner is known, dynamically tracks confirmed count
  const showSFDivider = playoffsStarted && !isTop8
    ? (finalistIds?.size ?? 0) === 0          // TOP4: until first SF winner
    : isTop8 && sfCount > 0;                  // TOP8: as QF winners emerge
  const sfDividerAfterRank = isTop8 ? sfCount : playoffCutoff;

  // GF divider: once ≥1 SF winner is known
  const showFinalsDivider = (finalistIds?.size ?? 0) > 0;
  const finalsDividerAfterRank = finalistIds?.size ?? 2;

  return (
    <div className="mb-6 rounded-md border border-stone-800 bg-stone-900/40 overflow-hidden">
      <div className="px-4 py-3 border-b border-stone-800 bg-stone-900/60">
        <h3 className="font-display text-base font-semibold text-rizzotto-gold-500">
          Standings (Round {displayRound}/{recommendedRounds})
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
              const rank = idx + 1;
              const displayName = entry.username ?? entry.userId;
              const factionId = entry.factionId ?? playerFactionMap?.get(entry.userId);
              const faction = factionId ? factionMap?.get(factionId) : undefined;
              const isFinalist = finalistIds?.has(entry.userId);
              const isDropped = entry.dropped === true;

              const placementKey = (rank <= 4 && !isDropped ? rank : undefined) as 1 | 2 | 3 | 4 | undefined;
              const badge = placementKey ? PLACEMENT_BADGE[placementKey] : null;

              return (
                <>
                  {/* GF divider: after confirmed finalists */}
                  {showFinalsDivider && rank === finalsDividerAfterRank + 1 && (
                    <Divider label="Advance to Grand Final" colSpan={colCount} />
                  )}
                  {/* SF divider: after confirmed SF qualifiers */}
                  {showSFDivider && rank === sfDividerAfterRank + 1 && (
                    <Divider label="Advance to Semifinals" colSpan={colCount} />
                  )}
                  {/* QF divider: TOP8 only, before any QF is resolved */}
                  {showQFDivider && rank === playoffCutoff + 1 && (
                    <Divider label="Advance to Quarterfinals" colSpan={colCount} />
                  )}
                  <tr
                    key={entry.userId}
                    className={`hover:bg-stone-800/30 transition-colors ${isFinalist ? 'bg-rizzotto-gold-500/5' : ''} ${isDropped ? 'opacity-50' : ''}`}
                  >
                    <td className="px-4 py-2 text-stone-500">
                      {badge ? (
                        <span className={`rounded border px-1.5 py-px text-[10px] font-bold uppercase tracking-wider ${badge.className}`}>
                          {badge.label}
                        </span>
                      ) : rank}
                    </td>
                    <td className="px-4 py-2">
                      <Link
                        to="/users/$id"
                        params={{ id: entry.userId }}
                        className="flex items-center gap-2 hover:text-rizzotto-gold-500 transition-colors"
                      >
                        <Avatar url={entry.avatarUrl} username={displayName} />
                        <span className={`${isDropped ? 'line-through text-stone-500' : 'text-stone-200'}`}>
                          {displayName}
                        </span>
                        {isDropped && (
                          <span className="text-[10px] text-amber-600/80 uppercase tracking-wider font-semibold">Withdrew</span>
                        )}
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
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
