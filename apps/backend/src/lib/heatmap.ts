import type { PrismaClient } from '@rizzotto/db';
import type { MatchupCell } from '@rizzotto/types';

// ---------------------------------------------------------------------------
// Raw row shape returned by Postgres $queryRaw
// ---------------------------------------------------------------------------

interface RawMatchupRow {
  faction_a_id: string;
  faction_b_id: string;
  faction_a_wins: bigint | number | string;
  faction_b_wins: bigint | number | string;
  draws: bigint | number | string;
  total: bigint | number | string;
  winrate_a: number | string | null;
}

// ---------------------------------------------------------------------------
// getMatchupMatrix
// ---------------------------------------------------------------------------

/**
 * Fetch all MatchupStats rows for a given season and return them as
 * MatchupCell objects with correctly typed numeric fields.
 *
 * Uses $queryRaw so the same function can be reused for GraphQL (M3.9).
 *
 * Postgres may return aggregate/arithmetic columns as bigint or decimal
 * strings — we normalise everything via Number().
 */
export async function getMatchupMatrix(
  prisma: PrismaClient,
  seasonId: string,
): Promise<MatchupCell[]> {
  const rows = await prisma.$queryRaw<RawMatchupRow[]>`
    SELECT
      ms.faction_a_id,
      ms.faction_b_id,
      ms.faction_a_wins,
      ms.faction_b_wins,
      ms.draws,
      (ms.faction_a_wins + ms.faction_b_wins + ms.draws) AS total,
      CASE
        WHEN (ms.faction_a_wins + ms.faction_b_wins + ms.draws) > 0
        THEN ms.faction_a_wins::float / NULLIF(ms.faction_a_wins + ms.faction_b_wins + ms.draws, 0)
        ELSE NULL
      END AS winrate_a
    FROM "MatchupStats" ms
    WHERE ms.season_id = ${seasonId}
    ORDER BY ms.faction_a_id, ms.faction_b_id
  `;

  return rows.map((r) => ({
    faction_a_id: r.faction_a_id,
    faction_b_id: r.faction_b_id,
    faction_a_wins: Number(r.faction_a_wins),
    faction_b_wins: Number(r.faction_b_wins),
    draws: Number(r.draws),
    total: Number(r.total),
    winrate_a: r.winrate_a === null ? null : Number(r.winrate_a),
  }));
}
