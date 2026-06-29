import type { PrismaClient } from '@rizzotto/db';
import type { MatchupCell } from '@rizzotto/types';

// ---------------------------------------------------------------------------
// getMatchupMatrix
// ---------------------------------------------------------------------------

/**
 * Builds the faction-vs-faction matchup matrix for a season by aggregating the
 * source of truth live: every COMPLETED MatchGame (game-level, so a Bo3
 * contributes up to three observations, and per-game factions for 2FT/3FT/MATRIX
 * are honoured).
 *
 * This intentionally does NOT read the persisted `MatchupStats` snapshot, which
 * only updates on the per-game completion path and drifts out of sync with the
 * real data (e.g. legacy-path completions or games whose faction was set late).
 * Aggregating live keeps the heatmap consistent with the games list. Callers
 * cache the result (the matchups endpoint caches 120s), so the per-request cost
 * is bounded.
 *
 * Mirrors the matchup logic in `recomputeFactionStats()`: pairs are keyed with
 * the lexicographically smaller faction id as `faction_a`, draws have no winner,
 * and games with a faction missing on either side cannot be attributed.
 */
export async function getMatchupMatrix(
  prisma: PrismaClient,
  seasonId: string,
): Promise<MatchupCell[]> {
  const games = await prisma.matchGame.findMany({
    where: {
      status: 'COMPLETED',
      match: { season_id: seasonId, deleted_at: null },
    },
    select: {
      winner_id: true,
      player1_faction_id: true,
      player2_faction_id: true,
      match: { select: { player1_id: true, player2_id: true } },
    },
  });

  // Keyed by `${aId}|${bId}` with aId <= bId (string sort).
  type Agg = { aWins: number; bWins: number; draws: number };
  const matchupAgg = new Map<string, Agg>();

  for (const g of games) {
    const p1f = g.player1_faction_id;
    const p2f = g.player2_faction_id;
    if (!p1f || !p2f) continue; // a matchup needs both factions known

    const isDraw = g.winner_id === null;
    let winnerFaction: string | null = null;
    if (!isDraw) {
      if (g.winner_id === g.match.player1_id) winnerFaction = p1f;
      else if (g.winner_id === g.match.player2_id) winnerFaction = p2f;
    }

    const [aId, bId] = [p1f, p2f].sort() as [string, string];
    const key = `${aId}|${bId}`;
    let m = matchupAgg.get(key);
    if (!m) {
      m = { aWins: 0, bWins: 0, draws: 0 };
      matchupAgg.set(key, m);
    }
    if (isDraw) m.draws++;
    else if (winnerFaction === aId) m.aWins++;
    else m.bWins++;
  }

  return [...matchupAgg.entries()]
    .map(([key, m]) => {
      const [faction_a_id, faction_b_id] = key.split('|') as [string, string];
      const total = m.aWins + m.bWins + m.draws;
      return {
        faction_a_id,
        faction_b_id,
        faction_a_wins: m.aWins,
        faction_b_wins: m.bWins,
        draws: m.draws,
        total,
        winrate_a: total > 0 ? m.aWins / total : null,
      };
    })
    .sort((x, y) =>
      x.faction_a_id === y.faction_a_id
        ? x.faction_b_id.localeCompare(y.faction_b_id)
        : x.faction_a_id.localeCompare(y.faction_a_id),
    );
}
