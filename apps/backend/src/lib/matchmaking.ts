/**
 * Fair-matchmaking engine — the shared Chance-to-Win (CtW) scorer and the balanced-faction
 * finder. See plans/matchmaking-engine-design.md. This is the pure core; the DB loader
 * (loadMatchmakingData) is the only impure part.
 *
 * CtW(A with factionX  vs  B with factionY) = logistic( (skillA_X − skillB_Y) + muTilt(X,Y) )
 *   - skill = the model's per-(player,faction) log-odds (getPlayerFactionSkill)
 *   - muTilt(X,Y) = the model's skill-adjusted matchup effect (getMatchupEffect), so
 *     logistic(muTilt) is the "favourability" rating shown on the site — the faction-vs-faction
 *     advantage with opponent strength removed. DECIDED (Alex): use the favourability rating, NOT
 *     the raw win-rate, which is contaminated by who the opponents were (e.g. a 50% raw rate
 *     achieved against weak opponents is really a sub-50% matchup). The tilt is resolved from the
 *     rating model by the DB loader (matchmaking-service.ts); this file stays pure.
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
 * How unfair a fixed player-vs-player matchup is, in [0, 0.5]: 0 = a perfect coin-flip, 0.5 = a
 * certain result. Includes each player's skill with their faction — used by the single-match
 * challenge finder, where the two concrete players matter.
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

/**
 * How unfair a faction matchup is on the FACTION LEVEL ALONE, in [0, 0.5] — the players' skill is
 * deliberately ignored. This is the cost the Faction-War optimiser minimises across a round:
 * "regardless of who the players are" (see plans/matchmaking-engine-design.md, block 4). The tilt
 * is the model's skill-adjusted matchup effect (getMatchupEffect), so `logistic(tilt)` equals the
 * "favourability" rating shown on the site — NOT the raw win-rate (which is contaminated by
 * opponent strength). The DB loader (matchmaking-service.ts) resolves the tilt from the model.
 */
export function factionUnfairness(
  data: Pick<MatchmakingData, 'factionTilt'>,
  factionX: string,
  factionY: string,
): number {
  return Math.abs(logistic(data.factionTilt(factionX, factionY).tilt) - 0.5);
}
