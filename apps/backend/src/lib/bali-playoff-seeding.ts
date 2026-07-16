// BaLi 2.0 divisional-playoff cross-band seeding handicap. Locked 2026-07-15.
//
// When bands are merged into one division, a borrowed lower-band player's Swiss points came from
// their own (balanced) band — a 5-0 in b2 ≠ a 5-0 in b4. So discount a borrowed player by a fixed
// fraction of a PERFECT score per band below the division's own band; the discount therefore SCALES
// with the round count (a flat −1 would fade as rounds grow). Then normal tie-breakers.
//
// 0.2 ⇒ H = 0.2×rounds per band (3/4/5/6 rounds → 0.6/0.8/1.0/1.2), implying a ~70% cross-band win
// edge — Alex's calibration (B4 5-0 ties B5 4-1 at 5 rounds). The 6-round harshness (borrowed 6-0 <
// top 5-1) is self-limiting and rarely bites. There is NO Seat-1 own-band reservation — the
// handicapped score decides, so a lone 0-5 top-band player does not head the bracket.

/** Fraction of a perfect score deducted per band below the division's own band. Tunable. */
export const HANDICAP_PER_BAND_FRACTION = 0.2;

/** Points subtracted from a player's Swiss score for seeding in `divisionBand`'s playoff. */
export function playoffHandicap(rounds: number, divisionBand: number, playerBand: number): number {
  const bandsBelow = Math.max(0, divisionBand - playerBand);
  return HANDICAP_PER_BAND_FRACTION * rounds * bandsBelow;
}

/** A player's handicap-adjusted seeding score (raw Swiss score minus the cross-band handicap). */
export function adjustedSeedScore(
  rawScore: number,
  rounds: number,
  divisionBand: number,
  playerBand: number,
): number {
  return rawScore - playoffHandicap(rounds, divisionBand, playerBand);
}
