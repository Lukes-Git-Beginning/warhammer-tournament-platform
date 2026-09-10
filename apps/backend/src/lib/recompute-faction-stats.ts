import type { PrismaClient, $Enums } from '@rizzotto/db';

type BattleType = $Enums.BattleType;

export interface RecomputeFactionStatsResult {
  versionId: string;
  factionStatsRows: number;
  matchupStatsRows: number;
  gamesProcessed: number;
}

/**
 * Rebuilds FactionStats and MatchupStats for a version from the source of truth:
 * the COMPLETED MatchGame records, split per battle type (design doc §4). Stats are
 * GAME-level — a Bo3 contributes up to three observations, and per-game factions
 * (2FT/3FT/MATRIX) are honoured.
 *
 * Idempotent: existing rows for the version are deleted and rebuilt in a single
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
 * - Rows are keyed per (faction, version, battle_type) so Domination / Conquest /
 *   Siege stay separate meta epochs.
 */
export async function recomputeFactionStats(
  prisma: PrismaClient,
  versionId: string,
): Promise<RecomputeFactionStatsResult> {
  const games = await prisma.matchGame.findMany({
    where: {
      status: 'COMPLETED',
      match: { version_id: versionId, deleted_at: null },
    },
    select: {
      winner_id: true,
      player1_faction_id: true,
      player2_faction_id: true,
      battle_type: true,
      match: { select: { player1_id: true, player2_id: true } },
    },
  });

  type FactionAgg = {
    faction_id: string;
    battle_type: BattleType;
    games: number;
    wins: number;
    losses: number;
    draws: number;
  };
  const factionAgg = new Map<string, FactionAgg>();
  const ensureFaction = (faction_id: string, battle_type: BattleType): FactionAgg => {
    const key = `${faction_id}|${battle_type}`;
    let agg = factionAgg.get(key);
    if (!agg) {
      agg = { faction_id, battle_type, games: 0, wins: 0, losses: 0, draws: 0 };
      factionAgg.set(key, agg);
    }
    return agg;
  };

  // Keyed by `${aId}|${bId}|${battleType}` with aId < bId — matches the heatmap convention.
  type MatchupAgg = {
    faction_a_id: string;
    faction_b_id: string;
    battle_type: BattleType;
    aWins: number;
    bWins: number;
    draws: number;
  };
  const matchupAgg = new Map<string, MatchupAgg>();

  let gamesProcessed = 0;

  for (const g of games) {
    const p1f = g.player1_faction_id;
    const p2f = g.player2_faction_id;
    if (!p1f && !p2f) continue; // no faction data — cannot attribute
    const bt = g.battle_type;

    gamesProcessed++;

    const isDraw = g.winner_id === null;
    let winnerFaction: string | null = null;
    if (!isDraw) {
      if (g.winner_id === g.match.player1_id) winnerFaction = p1f;
      else if (g.winner_id === g.match.player2_id) winnerFaction = p2f;
    }

    if (p1f) {
      const agg = ensureFaction(p1f, bt);
      agg.games++;
      if (isDraw) agg.draws++;
      else if (winnerFaction === p1f) agg.wins++;
      else agg.losses++;
    }
    if (p2f) {
      const agg = ensureFaction(p2f, bt);
      agg.games++;
      if (isDraw) agg.draws++;
      else if (winnerFaction === p2f) agg.wins++;
      else agg.losses++;
    }

    if (p1f && p2f) {
      const [aId, bId] = [p1f, p2f].sort() as [string, string];
      const key = `${aId}|${bId}|${bt}`;
      let m = matchupAgg.get(key);
      if (!m) {
        m = { faction_a_id: aId, faction_b_id: bId, battle_type: bt, aWins: 0, bWins: 0, draws: 0 };
        matchupAgg.set(key, m);
      }
      if (isDraw) m.draws++;
      else if (winnerFaction === aId) m.aWins++;
      else m.bWins++;
    }
  }

  const factionRows = [...factionAgg.values()].map((agg) => ({
    faction_id: agg.faction_id,
    version_id: versionId,
    battle_type: agg.battle_type,
    matches_played: agg.games,
    wins: agg.wins,
    losses: agg.losses,
    draws: agg.draws,
    pick_count: agg.games,
    ban_count: 0,
  }));

  const matchupRows = [...matchupAgg.values()].map((m) => ({
    faction_a_id: m.faction_a_id,
    faction_b_id: m.faction_b_id,
    version_id: versionId,
    battle_type: m.battle_type,
    faction_a_wins: m.aWins,
    faction_b_wins: m.bWins,
    draws: m.draws,
  }));

  await prisma.$transaction(async (tx) => {
    await tx.factionStats.deleteMany({ where: { version_id: versionId } });
    await tx.matchupStats.deleteMany({ where: { version_id: versionId } });
    if (factionRows.length) await tx.factionStats.createMany({ data: factionRows });
    if (matchupRows.length) await tx.matchupStats.createMany({ data: matchupRows });
  });

  return {
    versionId,
    factionStatsRows: factionRows.length,
    matchupStatsRows: matchupRows.length,
    gamesProcessed,
  };
}
