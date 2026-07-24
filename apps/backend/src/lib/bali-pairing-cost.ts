// BaLi 2.0 pairing cost — progressive/asymmetric band-gap + rematch penalties.
// Locked design 2026-07-15 (plans/bali-investigation-and-backlog-2026-07-15.md).
//
// Principles (each hard-won in review — do NOT "simplify" without re-checking them):
//  - Every Δ1 (adjacent bands) is UNIFORM + cheap and MUST stay < EVENTUAL_REMATCH_COST, so a fresh
//    one-band play-up always beats a rematch, and low bands are never repelled (a b2 must not prefer
//    b3 over b1). The asymmetry ("a gap hurts more the lower the weaker player") lives ONLY in gaps
//    ≥ 2. Same band (gap 0) = 0.
//  - Every Δ2 now costs > 2.0 (Alex 2026-07-23): concentrating a 2-band jump on ONE weaker player
//    must cost more than spreading it across TWO Δ1 singles (2×1.0), so the optimiser prefers the
//    two singles. Since 2.1 > 1.5 this also puts a lone Δ2 ABOVE an eventual rematch — replaying an
//    old opponent now beats a 2-band stomp. b1 keeps a steeper Δ2 (2.5): the asymmetry survives.
//  - Immediate rematch (last round) = forbidden. Eventual (earlier) rematch = soft ~1.5-band penalty.
// Numbers are ILLUSTRATIVE — validate/tune via the pairing simulation before shipping.

/** Eventual (non-consecutive) rematch penalty ≈ 1.5 bands. A fresh Δ1 play-up (1.0) beats it. */
export const EVENTUAL_REMATCH_COST = 1.5;
/** An immediate rematch (two who just played) is effectively forbidden. */
export const IMMEDIATE_REMATCH_COST = Infinity;

/** Progressive band-gap cost as cost[lowerBand] = [Δ1, Δ2, Δ3, Δ4]. */
const BAND_GAP_COST: Record<number, number[]> = {
  1: [1.0, 2.5, 5.0, 9.0],
  2: [1.0, 2.1, 4.0],
  3: [1.0, 2.1],
  4: [1.0],
};

/** Cost of the band gap alone (symmetric). Same band = 0; unknown/out-of-range = prohibitive. */
export function bandGapCost(bandA: number, bandB: number): number {
  const gap = Math.abs(bandA - bandB);
  if (gap === 0) return 0;
  const lower = Math.min(bandA, bandB);
  return BAND_GAP_COST[lower]?.[gap - 1] ?? Infinity;
}

export interface RematchState {
  /** a and b played each other in the IMMEDIATELY previous round → forbidden. */
  immediate: boolean;
  /** a and b have met at some earlier round → soft penalty. */
  metBefore: boolean;
}

/** Total pairing cost = band gap + rematch penalty. Lower is better. */
export function pairCost(bandA: number, bandB: number, rematch: RematchState): number {
  if (rematch.immediate) return IMMEDIATE_REMATCH_COST;
  return bandGapCost(bandA, bandB) + (rematch.metBefore ? EVENTUAL_REMATCH_COST : 0);
}

/**
 * #11 late-join reclaim gate (Alex 2026-07-24). When a late joiner reaches an already-formed
 * round, the engine may pull an existing bye-holder into a real match with them — but that
 * pairing must be LEGAL: its band gap may not EXCEED the round's current worst committed gap (so a
 * late join is never the round's biggest gap), and it may not be an immediate rematch. When the
 * reclaim does NOT involve a still-catching-up late joiner (normal round formation), it is always
 * allowed — the gate only constrains late-join accommodation.
 */
export function isLegalLateJoinReclaim(opts: {
  involvesCatchup: boolean;
  holderBand: number;
  joinerBand: number;
  roundMaxGap: number;
  immediateRematch: boolean;
}): boolean {
  if (!opts.involvesCatchup) return true;
  if (Math.abs(opts.holderBand - opts.joinerBand) > opts.roundMaxGap) return false;
  return !opts.immediateRematch;
}
