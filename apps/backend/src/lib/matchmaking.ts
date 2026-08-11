/**
 * Fair-matchmaking engine — the shared Chance-to-Win (CtW) scorer and the balanced-faction
 * finder. See plans/matchmaking-engine-design.md. This is the pure core; the DB loader
 * (loadMatchmakingData) is the only impure part.
 *
 * CtW(A with factionX  vs  B with factionY) = logistic( (skillA_X − skillB_Y) + muTilt(X,Y) )
 *   - skill = the model's per-(player,faction) log-odds (getPlayerFactionSkill)
 *   - muTilt(X,Y) = faction-vs-faction advantage in log-odds. DECIDED (Alex): the REAL measured
 *     matchup rate whenever there's ≥1 decisive game (no shrinkage toward 50%); only a
 *     never-played pair falls back to the Model-Strength delta. Model-Strength is worthless
 *     *relative to* real data but beats a blind 50% at zero data.
 */

import { logistic } from './rating-model.js';

/** Numerically-safe inverse logistic. Clamped so a 0/1 rate can't produce ±∞. */
export function logit(p: number): number {
  const q = Math.min(0.985, Math.max(0.015, p));
  return Math.log(q / (1 - q));
}

/** One balanced faction setup between two players, with the predicted coin-flip. */
export interface BalancedSetup {
  factionX: string; // player A's faction
  factionY: string; // player B's faction
  ctw: number; // predicted Chance-to-Win for A (0–1); balanced ≈ 0.5
  hasData: boolean; // false when the faction pair had no games (Model-Strength fallback)
}

/**
 * Everything the pure scorer needs, resolved from the DB once. Kept as plain functions so the
 * scorer stays unit-testable with hand-built stubs (no DB, no model).
 */
export interface MatchmakingData {
  /** Per-(player, faction) skill in log-odds (0 for an unseen pairing — the model's prior). */
  skillOf: (playerId: string, factionId: string) => number;
  /** Faction X-vs-Y advantage in log-odds, and whether it came from real games. */
  factionTilt: (factionX: string, factionY: string) => { tilt: number; hasData: boolean };
}

/** Predicted Chance-to-Win for A (with factionX) against B (with factionY). */
export function chanceToWin(
  data: MatchmakingData,
  playerA: string,
  factionX: string,
  playerB: string,
  factionY: string,
): number {
  const { tilt } = data.factionTilt(factionX, factionY);
  return logistic(data.skillOf(playerA, factionX) - data.skillOf(playerB, factionY) + tilt);
}

const DEFAULT_BAND = 0.025; // 47.5–52.5%

/**
 * For two players and their eligible faction sets, return the balanced setups (CtW within the
 * band), closest-to-50% first. `requireData: true` (challenges) skips never-played pairs
 * entirely; `false` (Faction War) keeps the Model-Strength fallback.
 */
export function findBalancedFactions(
  data: MatchmakingData,
  playerA: string,
  playerB: string,
  factionsA: string[],
  factionsB: string[],
  opts: { band?: number; requireData?: boolean } = {},
): BalancedSetup[] {
  const band = opts.band ?? DEFAULT_BAND;
  const setups: BalancedSetup[] = [];
  for (const factionX of factionsA) {
    for (const factionY of factionsB) {
      const { tilt, hasData } = data.factionTilt(factionX, factionY);
      if (opts.requireData && !hasData) continue; // challenge: only propose known matchups
      const ctw = logistic(data.skillOf(playerA, factionX) - data.skillOf(playerB, factionY) + tilt);
      setups.push({ factionX, factionY, ctw, hasData });
    }
  }
  return setups
    .filter((s) => Math.abs(s.ctw - 0.5) <= band)
    .sort((a, b) => Math.abs(a.ctw - 0.5) - Math.abs(b.ctw - 0.5));
}

/**
 * How unfair a fixed matchup is, in [0, 0.5]: 0 = a perfect coin-flip, 0.5 = a certain result.
 * The cost the Faction-War optimiser minimises across a whole round.
 */
export function unfairness(
  data: MatchmakingData,
  playerA: string,
  factionX: string,
  playerB: string,
  factionY: string,
): number {
  return Math.abs(chanceToWin(data, playerA, factionX, playerB, factionY) - 0.5);
}

// ---------------------------------------------------------------------------
// muTilt — faction-vs-faction advantage from the matchup matrix, Model-Strength at 0 games.
// ---------------------------------------------------------------------------

/** Minimal raw-matrix cell shape (subset of MatchupCell from heatmap.ts). */
export interface MatchupCounts {
  faction_a_id: string; // lexicographically smaller id
  faction_b_id: string;
  faction_a_wins: number;
  faction_b_wins: number;
}

/**
 * Build a `factionTilt` function from raw matchup counts + a Model-Strength map.
 * - real rate when the pair has ≥1 decisive game (raw win-rate → log-odds, NO shrinkage)
 * - Model-Strength delta (logit strengthX − logit strengthY) when the pair never played
 * - a neutral 0 only if even Model-Strength is missing for both factions
 */
export function makeFactionTilt(
  cells: MatchupCounts[],
  strengthByFaction: Map<string, number>,
): (factionX: string, factionY: string) => { tilt: number; hasData: boolean } {
  const byPair = new Map<string, MatchupCounts>();
  for (const c of cells) byPair.set(`${c.faction_a_id}|${c.faction_b_id}`, c);

  return (factionX: string, factionY: string) => {
    if (factionX === factionY) return { tilt: 0, hasData: false }; // mirror — a true coin-flip
    const [a, b] = factionX < factionY ? [factionX, factionY] : [factionY, factionX];
    const cell = byPair.get(`${a}|${b}`);
    if (cell) {
      const xWins = factionX === a ? cell.faction_a_wins : cell.faction_b_wins;
      const yWins = factionX === a ? cell.faction_b_wins : cell.faction_a_wins;
      const decisive = xWins + yWins;
      if (decisive > 0) return { tilt: logit(xWins / decisive), hasData: true };
    }
    // never played (or all draws) → Model-Strength delta; neutral if we don't even have that.
    const sX = strengthByFaction.get(factionX);
    const sY = strengthByFaction.get(factionY);
    if (sX === undefined && sY === undefined) return { tilt: 0, hasData: false };
    return { tilt: logit(sX ?? 0.5) - logit(sY ?? 0.5), hasData: false };
  };
}
