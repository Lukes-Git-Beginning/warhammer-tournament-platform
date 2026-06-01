// ---------------------------------------------------------------------------
// Rating Model — L2-regularised logistic regression (Alex-Spec)
//
// Fits two parameter groups from confirmed match outcomes of one season:
//   - PlayerFactionSkill(player, faction)  — one scalar per (player, faction)
//   - MatchupEffect(factionX, factionY)    — antisymmetric, mirror = 0
//
// Model (A on faction X vs B on faction Y, from A's perspective):
//   ExpectedAdvantage(A) = PFS(A,X) - PFS(B,Y) + MatchupEffect(X,Y)
//   p(A wins)            = logistic(ExpectedAdvantage) = 1 / (1 + exp(-adv))
//
// Loss = Σ binary-log-loss + L2:
//   loss = Σ -[y·log(p) + (1-y)·log(1-p)]
//        + lambdaPlayerFaction · Σ PFS²
//        + lambdaMatchup       · Σ MatchupEffect²
//
// We deliberately do NOT model general player skill — only per-faction skill.
// Scale: natural log-odds (logistic). PFS/ME values of ±1 ≈ 73%/27% win chance.
// The Elo-style 1/(1+10^(-adv/400)) form is just a reparametrisation; we stay
// in natural log-odds and document it here.
//
// Identifiability: ExpectedAdvantage only depends on PFS *differences*, so the
// raw log-loss has a gauge freedom (adding a constant to all PFS is invisible).
// L2 regularisation (shrinkage toward 0) removes it — the regularised objective
// is strictly convex and has a unique minimum — and also prevents extreme values
// for low-sample (player, faction) or matchup cells. No extra anchor constraint
// is required.
//
// Optimiser: batch gradient descent with Adam. Deterministic — zero init, fixed
// iteration order, no randomness — so an identical dataset always yields an
// identical fit (required because the result is cached + must be rebuildable).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One confirmed match, from player A's perspective. */
export interface MatchObservation {
  playerAId: string;
  playerBId: string;
  factionXId: string; // A's faction
  factionYId: string; // B's faction
  aWon: boolean; // y = 1 when A won, 0 otherwise
}

export interface RatingModelConfig {
  lambdaPlayerFaction: number; // L2 on PlayerFactionSkill
  lambdaMatchup: number; // L2 on MatchupEffect
  maxIterations: number;
  learningRate: number;
  convergenceTol: number; // stop when |Δloss| < tol
  lowSampleThreshold: number; // games/sampleSize below this → lowSampleWarning
}

export const DEFAULT_RATING_MODEL_CONFIG: RatingModelConfig = {
  // PFS has many parameters (sparse over player×faction): moderate shrinkage.
  lambdaPlayerFaction: 0.1,
  // MatchupEffect is global and should move off 0 only with real evidence:
  // stronger regularisation.
  lambdaMatchup: 0.5,
  maxIterations: 500,
  learningRate: 0.05,
  convergenceTol: 1e-7,
  lowSampleThreshold: 5,
};

export interface PlayerFactionSkillEntry {
  playerId: string;
  factionId: string;
  skill: number; // log-odds scale
  gamesCount: number;
  lowSampleWarning: boolean;
}

export interface MatchupEffectEntry {
  factionXId: string; // canonical X < Y; effect for (Y,X) is -effect
  factionYId: string;
  effect: number;
  sampleSize: number;
  lowSampleWarning: boolean;
}

/** Plain serialisable fit result (JSON-safe, cacheable). */
export interface RatingModelData {
  playerFactionSkills: PlayerFactionSkillEntry[];
  matchupEffects: MatchupEffectEntry[];
  fitIterations: number;
  finalLoss: number;
  totalMatches: number;
}

/** Serialisable data + derived lookup/prediction helpers. */
export interface RatingModel extends RatingModelData {
  getPlayerFactionSkill(playerId: string, factionId: string): number;
  getMatchupEffect(factionXId: string, factionYId: string): number;
  expectedChanceToWin(
    playerAId: string,
    factionXId: string,
    playerBId: string,
    factionYId: string,
  ): number;
}

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

const PROB_EPS = 1e-7;

/** Numerically stable logistic / sigmoid. */
export function logistic(z: number): number {
  if (z >= 0) {
    return 1 / (1 + Math.exp(-z));
  }
  const ez = Math.exp(z);
  return ez / (1 + ez);
}

function clampProb(p: number): number {
  return Math.min(1 - PROB_EPS, Math.max(PROB_EPS, p));
}

/** Split `${playerId}:${factionId}` on the first colon (UUIDs/slugs have none). */
function splitPfsKey(key: string): [string, string] {
  const i = key.indexOf(':');
  return [key.slice(0, i), key.slice(i + 1)];
}

function pfsKey(playerId: string, factionId: string): string {
  return `${playerId}:${factionId}`;
}

/** Canonical matchup key with X < Y; returns the key and the sign for (X,Y). */
function matchupKey(factionXId: string, factionYId: string): { key: string; sign: number } {
  return factionXId < factionYId
    ? { key: `${factionXId}:${factionYId}`, sign: 1 }
    : { key: `${factionYId}:${factionXId}`, sign: -1 };
}

// ---------------------------------------------------------------------------
// Model factory — rebuilds lookup maps + helpers from serialisable data.
// Used both by fitRatingModel() and when re-hydrating a cached fit.
// ---------------------------------------------------------------------------

export function createRatingModel(data: RatingModelData): RatingModel {
  const pfs = new Map<string, number>();
  for (const e of data.playerFactionSkills) {
    pfs.set(pfsKey(e.playerId, e.factionId), e.skill);
  }
  const me = new Map<string, number>();
  for (const e of data.matchupEffects) {
    me.set(`${e.factionXId}:${e.factionYId}`, e.effect);
  }

  const getPlayerFactionSkill = (playerId: string, factionId: string): number =>
    pfs.get(pfsKey(playerId, factionId)) ?? 0;

  const getMatchupEffect = (factionXId: string, factionYId: string): number => {
    if (factionXId === factionYId) return 0; // mirror
    const { key, sign } = matchupKey(factionXId, factionYId);
    return sign * (me.get(key) ?? 0);
  };

  const expectedChanceToWin = (
    playerAId: string,
    factionXId: string,
    playerBId: string,
    factionYId: string,
  ): number => {
    const adv =
      getPlayerFactionSkill(playerAId, factionXId) -
      getPlayerFactionSkill(playerBId, factionYId) +
      getMatchupEffect(factionXId, factionYId);
    return logistic(adv);
  };

  return {
    ...data,
    getPlayerFactionSkill,
    getMatchupEffect,
    expectedChanceToWin,
  };
}

// ---------------------------------------------------------------------------
// Fit
// ---------------------------------------------------------------------------

// Adam hyper-parameters (fixed — deterministic).
const ADAM_B1 = 0.9;
const ADAM_B2 = 0.999;
const ADAM_EPS = 1e-8;

export function fitRatingModel(
  observations: MatchObservation[],
  config: Partial<RatingModelConfig> = {},
): RatingModel {
  const cfg = { ...DEFAULT_RATING_MODEL_CONFIG, ...config };

  // --- 1. Build sparse parameter indices + sample counts ---------------------
  const pfsKeyToIdx = new Map<string, number>();
  const pfsGames: number[] = [];
  const meKeyToIdx = new Map<string, number>();
  const meSamples: number[] = [];

  const registerPfs = (key: string): number => {
    let idx = pfsKeyToIdx.get(key);
    if (idx === undefined) {
      idx = pfsKeyToIdx.size;
      pfsKeyToIdx.set(key, idx);
      pfsGames.push(0);
    }
    pfsGames[idx]! += 1;
    return idx;
  };

  // Pre-compile each observation into parameter indices to avoid re-parsing
  // keys inside the (potentially 500×) optimiser loop.
  const compiled = observations.map((o) => {
    const aIdx = registerPfs(pfsKey(o.playerAId, o.factionXId));
    const bIdx = registerPfs(pfsKey(o.playerBId, o.factionYId));

    let meIdx = -1;
    let meSign = 0;
    if (o.factionXId !== o.factionYId) {
      const { key, sign } = matchupKey(o.factionXId, o.factionYId);
      let idx = meKeyToIdx.get(key);
      if (idx === undefined) {
        idx = meKeyToIdx.size;
        meKeyToIdx.set(key, idx);
        meSamples.push(0);
      }
      meSamples[idx]! += 1;
      meIdx = idx;
      meSign = sign;
    }

    return { aIdx, bIdx, meIdx, meSign, y: o.aWon ? 1 : 0 };
  });

  const nPfs = pfsKeyToIdx.size;
  const nMe = meKeyToIdx.size;
  const len = nPfs + nMe;

  // ME parameter i lives at theta[nPfs + i].
  const theta = new Float64Array(len);
  const grad = new Float64Array(len);
  const m = new Float64Array(len);
  const v = new Float64Array(len);

  const { lambdaPlayerFaction: lPfs, lambdaMatchup: lMe, learningRate: lr } = cfg;

  // --- 2. Adam optimisation --------------------------------------------------
  let loss = 0;
  let prevLoss = Number.POSITIVE_INFINITY;
  let iter = 0;

  for (let t = 1; t <= cfg.maxIterations; t++) {
    iter = t;
    grad.fill(0);
    loss = 0;

    // Data term
    for (const c of compiled) {
      let adv = theta[c.aIdx]! - theta[c.bIdx]!;
      if (c.meIdx >= 0) adv += c.meSign * theta[nPfs + c.meIdx]!;

      const p = clampProb(logistic(adv));
      loss += -(c.y * Math.log(p) + (1 - c.y) * Math.log(1 - p));

      const r = p - c.y; // ∂loss/∂adv
      grad[c.aIdx]! += r; // ∂adv/∂PFS_A = +1
      grad[c.bIdx]! -= r; // ∂adv/∂PFS_B = -1
      if (c.meIdx >= 0) grad[nPfs + c.meIdx]! += c.meSign * r; // ±1 (antisymmetry)
    }

    // L2 term (PFS then ME blocks)
    for (let i = 0; i < nPfs; i++) {
      loss += lPfs * theta[i]! * theta[i]!;
      grad[i]! += 2 * lPfs * theta[i]!;
    }
    for (let i = nPfs; i < len; i++) {
      loss += lMe * theta[i]! * theta[i]!;
      grad[i]! += 2 * lMe * theta[i]!;
    }

    // Adam parameter update
    const b1Corr = 1 - Math.pow(ADAM_B1, t);
    const b2Corr = 1 - Math.pow(ADAM_B2, t);
    for (let i = 0; i < len; i++) {
      const g = grad[i]!;
      m[i] = ADAM_B1 * m[i]! + (1 - ADAM_B1) * g;
      v[i] = ADAM_B2 * v[i]! + (1 - ADAM_B2) * g * g;
      const mHat = m[i]! / b1Corr;
      const vHat = v[i]! / b2Corr;
      theta[i]! -= (lr * mHat) / (Math.sqrt(vHat) + ADAM_EPS);
    }

    if (Math.abs(prevLoss - loss) < cfg.convergenceTol) break;
    prevLoss = loss;
  }

  // --- 3. Assemble serialisable result ---------------------------------------
  const playerFactionSkills: PlayerFactionSkillEntry[] = [];
  for (const [key, idx] of pfsKeyToIdx) {
    const [playerId, factionId] = splitPfsKey(key);
    playerFactionSkills.push({
      playerId,
      factionId,
      skill: theta[idx]!,
      gamesCount: pfsGames[idx]!,
      lowSampleWarning: pfsGames[idx]! < cfg.lowSampleThreshold,
    });
  }

  const matchupEffects: MatchupEffectEntry[] = [];
  for (const [key, idx] of meKeyToIdx) {
    const [factionXId, factionYId] = splitPfsKey(key);
    matchupEffects.push({
      factionXId,
      factionYId,
      effect: theta[nPfs + idx]!,
      sampleSize: meSamples[idx]!,
      lowSampleWarning: meSamples[idx]! < cfg.lowSampleThreshold,
    });
  }

  return createRatingModel({
    playerFactionSkills,
    matchupEffects,
    fitIterations: iter,
    finalLoss: loss,
    totalMatches: observations.length,
  });
}
