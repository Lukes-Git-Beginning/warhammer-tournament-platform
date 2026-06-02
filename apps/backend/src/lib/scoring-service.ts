// ---------------------------------------------------------------------------
// Scoring Service — dynamic weighted leaderboard (Alex-Spec)
//
// Pure, synchronous point math. Every value is derived from confirmed match
// facts + the current rating model; nothing is stored. See rating-model.ts for
// PlayerFactionSkill / MatchupEffect / ExpectedChanceToWin.
//
//   RawPoints   = 100 * (1 - ExpectedChanceToWin)        — no cap, no floor
//   FinalPoints = RawPoints * OpponentModifier
//
// Anti-farming is player-specific and asymmetric: it only depends on how large
// a share of a player's own confirmed matches were played against one opponent.
// Repeated factions / matchups / faction-combos are deliberately NOT penalized.
// ---------------------------------------------------------------------------

/** Opponent-share thresholds (Alex-Spec). Exported for tests + documentation. */
export const OPPONENT_SHARE_FULL = 0.05; // <= 5%  → full value
export const OPPONENT_SHARE_ZERO = 0.1; //  >= 10% → zero value
export const MIN_MATCHES_FOR_ANTI_FARM = 20; // < 20 total matches → no penalty

/**
 * Raw victory points for the winner of a single match.
 * The more unlikely the win, the more it is worth.
 *
 *   90% expected win chance → 10 points
 *   50%                     → 50 points
 *   10%                     → 90 points
 */
export function rawPoints(expectedChanceToWin: number): number {
  return 100 * (1 - expectedChanceToWin);
}

/**
 * Player-specific opponent share: how large a fraction of THIS player's
 * confirmed matches were played against this opponent. Asymmetric by design —
 * A-vs-B and B-vs-A generally differ because the totals differ.
 *
 * Returns 0 when the player has no matches (avoids division by zero).
 */
export function opponentShare(matchesVsOpponent: number, playerTotalMatches: number): number {
  if (playerTotalMatches <= 0) return 0;
  return matchesVsOpponent / playerTotalMatches;
}

/**
 * Anti-farming modifier in [0, 1] applied to a win's raw points.
 *
 *   total matches < 20        → 1     (not enough history to farm)
 *   share <= 5%               → 1     (full value)
 *   share >= 10%              → 0     (zero value)
 *   otherwise                 → (0.10 - share) / 0.05   (linear ramp)
 *
 * Because share is recomputed from current data, a player who over-plays one
 * opponent early recovers those points later by playing many other opponents.
 */
export function opponentModifier(share: number, playerTotalMatches: number): number {
  if (playerTotalMatches < MIN_MATCHES_FOR_ANTI_FARM) return 1;
  if (share <= OPPONENT_SHARE_FULL) return 1;
  if (share >= OPPONENT_SHARE_ZERO) return 0;
  return (OPPONENT_SHARE_ZERO - share) / (OPPONENT_SHARE_ZERO - OPPONENT_SHARE_FULL);
}

/** Final points awarded for a win after the anti-farming modifier is applied. */
export function finalPoints(raw: number, modifier: number): number {
  return raw * modifier;
}
