// ---------------------------------------------------------------------------
// ELO Engine — Variant A2: Multi-Player Performance Rating
// Zero-sum at equal ratings, one-pass calculation.
// ---------------------------------------------------------------------------

export interface EloInput {
  userId: string;
  currentRating: number;
  placement: number;
}

export interface EloResult {
  userId: string;
  oldRating: number;
  newRating: number;
  delta: number;
}

export interface EloOptions {
  isMajor: boolean;
}

/**
 * Computes ELO deltas for a multi-player tournament.
 *
 * Formula (A2 — Performance Rating, mathematically zero-sum at equal ratings):
 *   scoreP_i    = (N - p_i) / (N - 1)
 *   expectedP_i = (1/(N-1)) * Σ_{j≠i} [ 1 / (1 + 10^((R_j - R_i) / 400)) ]
 *   K_eff       = isMajor ? 48 : 32
 *   elo_change_i = Math.round(K_eff * (scoreP_i - expectedP_i))
 *
 * Tie handling: players sharing the same `placement` value receive the averaged
 * scoreP for the ranks they occupy (e.g. two players tied at ranks 2+3 in a
 * 4-player field both get scoreP = ((4-2)+(4-3)) / (2*(4-1)) = 0.500).
 *
 * Edge cases:
 *   - N === 1: returns delta 0 for the single player (solo tournament).
 *   - No ELO floor — newRating can fall below 1200.
 */
export function computeEloDeltas(
  players: EloInput[],
  options: EloOptions,
): EloResult[] {
  const N = players.length;

  // Solo tournament — no meaningful ELO update possible
  if (N === 1) {
    const p = players[0]!;
    return [{ userId: p.userId, oldRating: p.currentRating, newRating: p.currentRating, delta: 0 }];
  }

  const K = options.isMajor ? 48 : 32;

  // ---------------------------------------------------------------------------
  // Resolve tied placements: group by placement value, compute average rank
  // Ranks are assigned as 1-based ordinal positions (1..N) sorted by placement.
  // Players with equal placement share the average of their consecutive ranks.
  // ---------------------------------------------------------------------------

  // Sort players by placement ascending to assign ordinal ranks
  const sorted = [...players].sort((a, b) => a.placement - b.placement);

  // Map userId → averaged scoreP (accounting for ties)
  const scoreMap = new Map<string, number>();

  let i = 0;
  while (i < sorted.length) {
    const currentPlacement = sorted[i]!.placement;

    // Find all players with the same placement
    let j = i;
    while (j < sorted.length && sorted[j]!.placement === currentPlacement) {
      j++;
    }

    // Players at indices i..j-1 share ordinal ranks (i+1)..(j) (1-based)
    // Average rank = (i+1 + j) / 2 = (i + j + 1) / 2
    // scoreP for averaged rank r: (N - r) / (N - 1)
    const avgRank = (i + j + 1) / 2; // e.g. tie at ranks 2,3 → avgRank = 2.5
    const scoreP = (N - avgRank) / (N - 1);

    for (let k = i; k < j; k++) {
      scoreMap.set(sorted[k]!.userId, scoreP);
    }

    i = j;
  }

  // ---------------------------------------------------------------------------
  // Compute expected score for each player via pairwise ELO expectations
  // ---------------------------------------------------------------------------

  const results: EloResult[] = [];

  for (const player of players) {
    const scoreP = scoreMap.get(player.userId)!;

    // expectedP_i = (1/(N-1)) * Σ_{j≠i} E(R_i, R_j)
    let expectedSum = 0;
    for (const opponent of players) {
      if (opponent.userId === player.userId) continue;
      // E(R_i, R_j) = 1 / (1 + 10^((R_j - R_i) / 400))
      expectedSum += 1 / (1 + Math.pow(10, (opponent.currentRating - player.currentRating) / 400));
    }
    const expectedP = expectedSum / (N - 1);

    const delta = Math.round(K * (scoreP - expectedP));
    results.push({
      userId: player.userId,
      oldRating: player.currentRating,
      newRating: player.currentRating + delta,
      delta,
    });
  }

  return results;
}
