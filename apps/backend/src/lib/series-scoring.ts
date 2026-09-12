import { z } from 'zod';

// ---------------------------------------------------------------------------
// Tournament Series — scoring & qualification (PURE, unit-testable).
// See plans/tournament-series-design.md.
//
// Model A — cumulative points across all qualifier games:
//   points = games_played * points_per_game_played + wins * points_per_win
//   → Top-N by the configured tiebreaker chain qualify.
// Model C — per-qualifier direct qualification: the Top-X finishers of each
//   qualifier qualify; already-qualified players are skipped so their slot
//   passes to the next non-qualified finisher.
// ---------------------------------------------------------------------------

export const TiebreakerSchema = z.enum(['points', 'wins', 'games', 'random']);
export type Tiebreaker = z.infer<typeof TiebreakerSchema>;

export const ScoringConfigSchema = z
  .object({
    // 'NONE' = grouping-only series (weekly format): no scoring, no qualification, final optional.
    model: z.enum(['A', 'C', 'NONE']),
    // Model A — cumulative points
    points_per_game_played: z.number().int().min(0).max(100).default(1),
    points_per_win: z.number().int().min(0).max(100).default(1),
    final_size: z.number().int().min(1).max(256).default(16),
    // Model C — per-qualifier direct qualification
    top_x: z.number().int().min(1).max(64).default(2),
    // Ordered tiebreak chain for Model A (evaluated left→right; 'random' is
    // deterministic per series so results are stable and reproducible).
    tiebreakers: z.array(TiebreakerSchema).min(1).default(['points', 'wins', 'games', 'random']),
  })
  .strip();

export type ScoringConfig = z.infer<typeof ScoringConfigSchema>;

/** One completed, leaderboard-counting game between two competitors. */
export interface SeriesGame {
  player1Id: string | null;
  player2Id: string | null;
  winnerId: string | null;
}

export interface SeriesStanding {
  competitorId: string;
  gamesPlayed: number;
  wins: number;
  points: number;
  rank: number; // 1-based, sequential after sort
  qualified: boolean; // Model A: within the Top-N final_size
}

// FNV-1a → unsigned 32-bit, used for the deterministic 'random' tiebreak.
function stableHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Model A standings across all qualifier games. `seriesId` seeds the deterministic
 * 'random' tiebreak. Returns rows sorted best→worst with rank + qualified flags.
 */
export function computeSeriesStandingsA(
  games: SeriesGame[],
  config: ScoringConfig,
  seriesId: string,
): SeriesStanding[] {
  const agg = new Map<string, { gamesPlayed: number; wins: number }>();
  const bump = (id: string | null, won: boolean): void => {
    if (!id) return;
    const e = agg.get(id) ?? { gamesPlayed: 0, wins: 0 };
    e.gamesPlayed += 1;
    if (won) e.wins += 1;
    agg.set(id, e);
  };
  for (const g of games) {
    bump(g.player1Id, g.winnerId != null && g.winnerId === g.player1Id);
    bump(g.player2Id, g.winnerId != null && g.winnerId === g.player2Id);
  }

  const rows: SeriesStanding[] = [...agg.entries()].map(([competitorId, e]) => ({
    competitorId,
    gamesPlayed: e.gamesPlayed,
    wins: e.wins,
    points: e.gamesPlayed * config.points_per_game_played + e.wins * config.points_per_win,
    rank: 0,
    qualified: false,
  }));

  const cmp = (a: SeriesStanding, b: SeriesStanding): number => {
    for (const tb of config.tiebreakers) {
      let d = 0;
      if (tb === 'points') d = b.points - a.points;
      else if (tb === 'wins') d = b.wins - a.wins;
      else if (tb === 'games') d = b.gamesPlayed - a.gamesPlayed;
      else d = stableHash(`${seriesId}:${a.competitorId}`) - stableHash(`${seriesId}:${b.competitorId}`);
      if (d !== 0) return d;
    }
    return 0;
  };
  rows.sort(cmp);
  rows.forEach((r, i) => {
    r.rank = i + 1;
    r.qualified = i < config.final_size;
  });
  return rows;
}

/** A qualifier's final placement for one competitor (1 = winner). */
export interface QualifierPlacement {
  tournamentId: string;
  competitorId: string;
  position: number; // 1-based final placement within that qualifier
}

export interface SeriesQualifierEntry {
  competitorId: string;
  fromTournamentId: string;
  position: number;
  seed: number; // 1-based order the player was locked in (for final seeding)
}

/**
 * Model C: walk the qualifiers in series order; take each qualifier's Top-X
 * finishers, skipping anyone already qualified (their slot passes down). The
 * resulting list is the final's field, in the order they qualified (seed 1 = the
 * earliest qualifier's winner). PURE.
 */
export function computeSeriesQualifiersC(
  perQualifier: QualifierPlacement[][],
  config: ScoringConfig,
): SeriesQualifierEntry[] {
  const qualified = new Set<string>();
  const out: SeriesQualifierEntry[] = [];
  for (const results of perQualifier) {
    const ordered = results.slice().sort((a, b) => a.position - b.position);
    let taken = 0;
    for (const r of ordered) {
      if (taken >= config.top_x) break;
      if (qualified.has(r.competitorId)) continue; // already in — slot passes to the next finisher
      qualified.add(r.competitorId);
      out.push({
        competitorId: r.competitorId,
        fromTournamentId: r.tournamentId,
        position: r.position,
        seed: out.length + 1,
      });
      taken += 1;
    }
  }
  return out;
}

/** Set of competitor ids already qualified in earlier qualifiers (Model C seeding skip). */
export function alreadyQualifiedIds(entries: SeriesQualifierEntry[]): Set<string> {
  return new Set(entries.map((e) => e.competitorId));
}
