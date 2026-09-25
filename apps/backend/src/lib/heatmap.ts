import type { PrismaClient, $Enums } from '@rizzotto/db';
import type { MatchupCell } from '@rizzotto/types';
import { eligibleStatGameWhere } from './stat-eligibility.js';
import { getVersionDecayWeights } from './factions.js';

// ---------------------------------------------------------------------------
// getMatchupMatrix
// ---------------------------------------------------------------------------

/**
 * Builds the faction-vs-faction matchup matrix for a version by aggregating the
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
 *
 * 1v1 only — like recomputeFactionStats, 2v2 games are excluded because
 * player1/2_faction_id hold only the captains' factions (the 2v2 meta is the
 * separate duo view). Open Play (null tournament) is always 1v1, so it stays.
 */
export async function getMatchupMatrix(
  prisma: PrismaClient,
  versionId: string, // a version UUID, or 'all' for the 1/k-decayed All-Time amalgam
  battleType?: $Enums.BattleType, // omitted = all battle types (aggregate overview)
): Promise<MatchupCell[]> {
  // "All time": span every version (eligible set with no version filter) and weight each game by
  // 1/k (its version's reverse-chronological rank) — older versions devalued, never dropped.
  const allTime = versionId === 'all';
  const weights = allTime ? await getVersionDecayWeights(prisma) : null;
  // Same canonical game set as the rating model (loadVersionObservations) so the two
  // heatmaps' sample sizes agree — see stat-eligibility.ts.
  const base = eligibleStatGameWhere(allTime ? null : versionId);
  const games = await prisma.matchGame.findMany({
    where: {
      ...base,
      ...(battleType ? { battle_type: battleType } : {}),
      match: { ...(base.match as object), NOT: { tournament: { competitor_format: 'TWO_V_TWO' } } },
    },
    select: {
      winner_id: true,
      player1_faction_id: true,
      player2_faction_id: true,
      match: { select: { player1_id: true, player2_id: true, version_id: true } },
    },
  });

  // Keyed by `${aId}|${bId}` with aId <= bId (string sort). Raw counts are the true game tallies
  // (displayed); the weighted sums apply the 1/k version decay and feed only the win rate.
  type Agg = {
    aWins: number; bWins: number; draws: number; // raw
    aWinsW: number; bWinsW: number; drawsW: number; // 1/k-weighted (All-Time win rate)
  };
  const matchupAgg = new Map<string, Agg>();

  for (const g of games) {
    const p1f = g.player1_faction_id;
    const p2f = g.player2_faction_id;
    if (!p1f || !p2f) continue; // a matchup needs both factions known
    if (p1f === p2f) continue; // mirror — no faction-vs-faction winrate is defined

    const w = allTime ? (weights!.get(g.match.version_id ?? '') ?? 0) : 1;
    if (w === 0) continue; // a version with no decay weight (shouldn't happen) contributes nothing

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
      m = { aWins: 0, bWins: 0, draws: 0, aWinsW: 0, bWinsW: 0, drawsW: 0 };
      matchupAgg.set(key, m);
    }
    if (isDraw) { m.draws += 1; m.drawsW += w; }
    else if (winnerFaction === aId) { m.aWins += 1; m.aWinsW += w; }
    else { m.bWins += 1; m.bWinsW += w; }
  }

  return [...matchupAgg.entries()]
    .map(([key, m]) => {
      const [faction_a_id, faction_b_id] = key.split('|') as [string, string];
      // Counts are RAW game tallies — All-Time must never show fewer games than a single version.
      // The win rate uses the 1/k-weighted sums (for a single version the weights are all 1, so it
      // equals the raw rate); All-Time then devalues older, out-of-date balance.
      const totalRaw = m.aWins + m.bWins + m.draws;
      const totalW = m.aWinsW + m.bWinsW + m.drawsW;
      return {
        faction_a_id,
        faction_b_id,
        faction_a_wins: m.aWins,
        faction_b_wins: m.bWins,
        draws: m.draws,
        total: totalRaw,
        winrate_a: totalW > 0 ? m.aWinsW / totalW : null,
      };
    })
    .sort((x, y) =>
      x.faction_a_id === y.faction_a_id
        ? x.faction_b_id.localeCompare(y.faction_b_id)
        : x.faction_a_id.localeCompare(y.faction_a_id),
    );
}
