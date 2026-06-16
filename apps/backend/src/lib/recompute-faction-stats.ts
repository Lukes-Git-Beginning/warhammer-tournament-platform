import type { PrismaClient } from '@rizzotto/db';

export interface RecomputeFactionStatsResult {
  seasonId: string;
  factionStatsRows: number;
  matchupStatsRows: number;
  gamesProcessed: number;
}

/**
 * Rebuilds FactionStats and MatchupStats for a season from the source of truth:
 * the COMPLETED MatchGame records. Stats are GAME-level — a Bo3 contributes up to
 * three observations, and per-game factions (2FT/3FT/MATRIX) are honoured.
 *
 * Idempotent: existing rows for the season are deleted and rebuilt in a single
 * transaction. This both fixes incremental drift (void/cancel/edit never corrected
 * the counters) and guarantees game-level counting regardless of which completion
 * path produced the data.
 *
 * Notes:
 * - The `matches_played` column now holds the *game* count (kept the column name to
 *   avoid a migration; all read sites already label it "Games").
 * - `pick_count` mirrors the game count — the legacy incremental writers conflated
 *   the two and there is no separate per-pick source today. `ban_count` stays 0.
 * - A COMPLETED game with no `winner_id` is treated as a draw.
 * - Games where neither faction is known are skipped (cannot be attributed).
 */
export async function recomputeFactionStats(
  prisma: PrismaClient,
  seasonId: string,
): Promise<RecomputeFactionStatsResult> {
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

  type FactionAgg = { games: number; wins: number; losses: number; draws: number };
  const factionAgg = new Map<string, FactionAgg>();
  const ensureFaction = (id: string): FactionAgg => {
    let agg = factionAgg.get(id);
    if (!agg) {
      agg = { games: 0, wins: 0, losses: 0, draws: 0 };
      factionAgg.set(id, agg);
    }
    return agg;
  };

  // Keyed by `${aId}|${bId}` with aId < bId (string sort) — matches the heatmap convention.
  type MatchupAgg = { aWins: number; bWins: number; draws: number };
  const matchupAgg = new Map<string, MatchupAgg>();

  let gamesProcessed = 0;

  for (const g of games) {
    const p1f = g.player1_faction_id;
    const p2f = g.player2_faction_id;
    if (!p1f && !p2f) continue; // no faction data — cannot attribute

    gamesProcessed++;

    const isDraw = g.winner_id === null;
    let winnerFaction: string | null = null;
    if (!isDraw) {
      if (g.winner_id === g.match.player1_id) winnerFaction = p1f;
      else if (g.winner_id === g.match.player2_id) winnerFaction = p2f;
    }

    if (p1f) {
      const agg = ensureFaction(p1f);
      agg.games++;
      if (isDraw) agg.draws++;
      else if (winnerFaction === p1f) agg.wins++;
      else agg.losses++;
    }
    if (p2f) {
      const agg = ensureFaction(p2f);
      agg.games++;
      if (isDraw) agg.draws++;
      else if (winnerFaction === p2f) agg.wins++;
      else agg.losses++;
    }

    if (p1f && p2f) {
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
  }

  const factionRows = [...factionAgg.entries()].map(([faction_id, agg]) => ({
    faction_id,
    season_id: seasonId,
    matches_played: agg.games,
    wins: agg.wins,
    losses: agg.losses,
    draws: agg.draws,
    pick_count: agg.games,
    ban_count: 0,
  }));

  const matchupRows = [...matchupAgg.entries()].map(([key, m]) => {
    const [faction_a_id, faction_b_id] = key.split('|') as [string, string];
    return {
      faction_a_id,
      faction_b_id,
      season_id: seasonId,
      faction_a_wins: m.aWins,
      faction_b_wins: m.bWins,
      draws: m.draws,
    };
  });

  await prisma.$transaction(async (tx) => {
    await tx.factionStats.deleteMany({ where: { season_id: seasonId } });
    await tx.matchupStats.deleteMany({ where: { season_id: seasonId } });
    if (factionRows.length) await tx.factionStats.createMany({ data: factionRows });
    if (matchupRows.length) await tx.matchupStats.createMany({ data: matchupRows });
  });

  return {
    seasonId,
    factionStatsRows: factionRows.length,
    matchupStatsRows: matchupRows.length,
    gamesProcessed,
  };
}
