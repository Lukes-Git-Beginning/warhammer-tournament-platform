// ---------------------------------------------------------------------------
// Rating Model — L2-regularised logistic regression (Alex-Spec)
//
// Fits two parameter groups from confirmed match outcomes of one version:
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
  // Battle-type dimension (hierarchical model). When set, the fit adds a
  // per-(player, battleType) skill offset, so "GS in Siege" = GS + Siege-offset.
  // Omitted (undefined) on legacy/aggregate calls → no battle-type level is fitted
  // and the model degenerates to exactly the prior GS + faction-offset behaviour.
  battleType?: string;
  // Version dimension (the meta split). When set, the MatchupEffect (faction
  // balance) is fitted per (versionId, battleType) — a patch's balance is isolated —
  // while player params (GS, BTO, FO) stay SHARED across versions (timeless).
  // Omitted → one global matchup bucket, exactly the prior behaviour.
  versionId?: string;
}

export interface RatingModelConfig {
  lambdaPlayerFaction: number; // L2 on PlayerFactionSkill (flat model only)
  lambdaMatchup: number; // L2 on MatchupEffect
  maxIterations: number;
  learningRate: number;
  convergenceTol: number; // stop when |Δloss| < tol
  lowSampleThreshold: number; // games/sampleSize below this → lowSampleWarning
  // --- Hierarchical (general-skill) model -----------------------------------
  // When true, PFS is re-parametrised as GS(player) + FO(player, faction):
  //   - GS = one faction-blind general-skill scalar per player (lightly reg.)
  //   - FO = per-(player,faction) offset from that general skill (strongly reg.)
  // The strong FO / light GS shrinkage yields "partial pooling": a thin
  // (player, faction) cell is pulled toward the player's OWN general skill,
  // not toward the global average — the better estimator (James–Stein). The
  // flat model is kept for a bit-exact baseline / gated rollout.
  hierarchical: boolean;
  lambdaGeneralSkill: number; // L2 on GS — small (let the common level float)
  lambdaFactionOffset: number; // L2 on FO — large (offsets move off 0 only with evidence)
  // L2 on the battle-type offset (BTO). Medium — a player's per-type skill is
  // pulled toward their OWN global GS (partial pooling / James–Stein), so a new
  // mode with few games starts at "≈ this player's global skill" and only diverges
  // with real evidence. ~5-game prior weight at 0.3 (see design doc §3).
  lambdaBattleTypeOffset: number;
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
  // Flat model is the default until the hierarchical rollout is approved.
  hierarchical: false,
  lambdaGeneralSkill: 0.05,
  lambdaFactionOffset: 0.5,
  // Medium shrinkage → ~5-game prior weight (10 games ≈ 2/3 of the true offset
  // shown). Calibrate on real 9.0 data once Siege/Conquest have volume.
  lambdaBattleTypeOffset: 0.3,
};

export interface PlayerFactionSkillEntry {
  playerId: string;
  factionId: string;
  skill: number; // log-odds scale — in the hierarchical model this is GS + FO (the sum)
  gamesCount: number;
  lowSampleWarning: boolean;
  /** Standard error of `skill` (hierarchical fit only; undefined in the flat model). */
  stdError?: number;
}

/**
 * Per-player faction-blind general skill (hierarchical fit only). `generalSkill`
 * is the GS scalar; `peakSkill` = GS + max(FO) across the factions the player has
 * actually played — used for "strong anywhere" gating.
 */
export interface GeneralSkillEntry {
  playerId: string;
  generalSkill: number; // GS, log-odds scale
  stdError: number; // SE of GS (Fisher-information diagonal)
  peakSkill: number; // GS + max(FO); === generalSkill when no faction played
  peakFactionId: string | null;
  gamesCount: number; // total decisive games across all factions
  factionsPlayed: number; // distinct factions with ≥1 game
}

export interface MatchupEffectEntry {
  factionXId: string; // canonical X < Y; effect for (Y,X) is -effect
  factionYId: string;
  effect: number;
  sampleSize: number;
  lowSampleWarning: boolean;
  // Scope of this matchup cell; present when the fit was version/battle-type-aware
  // (both set together), else undefined = the single global bucket.
  versionId?: string;
  battleType?: string;
}

/**
 * Per-(player, battle-type) skill offset from the player's global GS
 * (hierarchical fit only). "GS in this battle type" = generalSkill + offset.
 */
export interface BattleTypeOffsetEntry {
  playerId: string;
  battleType: string;
  offset: number; // log-odds, added to GS for this battle type
  gamesCount: number;
  stdError: number;
}

/** Plain serialisable fit result (JSON-safe, cacheable). */
export interface RatingModelData {
  playerFactionSkills: PlayerFactionSkillEntry[];
  matchupEffects: MatchupEffectEntry[];
  /** General-skill decomposition; empty array in the flat (non-hierarchical) model. */
  generalSkills: GeneralSkillEntry[];
  /** Battle-type offsets; empty when the flat model runs or no battleType was fitted. */
  battleTypeOffsets: BattleTypeOffsetEntry[];
  fitIterations: number;
  finalLoss: number;
  totalMatches: number;
}

/** A player's general-skill estimate with its confidence. */
export interface GeneralSkillLookup {
  skill: number; // GS
  se: number; // standard error
  confidence: number; // Fisher information = 1 / se² (precision)
  peakSkill: number;
  peakFactionId: string | null;
  gamesCount: number;
  factionsPlayed: number;
}

/** Serialisable data + derived lookup/prediction helpers. */
export interface RatingModel extends RatingModelData {
  getPlayerFactionSkill(playerId: string, factionId: string): number;
  getMatchupEffect(
    factionXId: string,
    factionYId: string,
    versionId?: string,
    battleType?: string,
  ): number;
  expectedChanceToWin(
    playerAId: string,
    factionXId: string,
    playerBId: string,
    factionYId: string,
    opts?: { battleType?: string; versionId?: string },
  ): number;
  /** General skill + confidence for a player; null if the player has no fitted GS. */
  getGeneralSkill(playerId: string): GeneralSkillLookup | null;
  /**
   * Peak faction skill (strongest observed faction) — GS + max(FO). Falls back to
   * the general skill when the player has no faction data. Optionally restrict to a
   * subset of factions (e.g. the ones eligible in a gated format).
   */
  getPeakFactionSkill(playerId: string, factions?: readonly string[]): number | null;
  /** Battle-type offset for a player (0 if none fitted). "GS in this type" = GS + this. */
  getBattleTypeOffset(playerId: string, battleType: string): number;
  /** GS + battle-type offset ("GS in this battle type"); null if the player has no fitted GS. */
  getBattleTypeSkill(playerId: string, battleType: string): number | null;
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

/**
 * Matchup-effect map key: a (versionId, battleType) scope prefix + the canonical
 * faction pair. versionId is a UUID and battleType an enum — neither contains '|',
 * and a faction pair contains only ':', so the parts are unambiguous. Empty scope
 * ('' | '') = the single global bucket (legacy / version-agnostic fit).
 */
function meKey(
  versionId: string | undefined,
  battleType: string | undefined,
  factionXId: string,
  factionYId: string,
): { key: string; sign: number } {
  const { key: pair, sign } = matchupKey(factionXId, factionYId);
  return { key: `${versionId ?? ''}|${battleType ?? ''}|${pair}`, sign };
}

/** Inverse of `meKey` — splits a stored key back into its scope + faction pair. */
function splitMeKey(key: string): {
  versionId: string | undefined;
  battleType: string | undefined;
  factionXId: string;
  factionYId: string;
} {
  const bar1 = key.indexOf('|');
  const bar2 = key.indexOf('|', bar1 + 1);
  const versionId = key.slice(0, bar1);
  const battleType = key.slice(bar1 + 1, bar2);
  const [factionXId, factionYId] = splitPfsKey(key.slice(bar2 + 1));
  return {
    versionId: versionId || undefined,
    battleType: battleType || undefined,
    factionXId,
    factionYId,
  };
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
    me.set(meKey(e.versionId, e.battleType, e.factionXId, e.factionYId).key, e.effect);
  }
  const gs = new Map<string, GeneralSkillEntry>();
  for (const e of data.generalSkills) {
    gs.set(e.playerId, e);
  }
  const bto = new Map<string, number>();
  for (const e of data.battleTypeOffsets ?? []) {
    bto.set(`${e.playerId}:${e.battleType}`, e.offset);
  }

  const getPlayerFactionSkill = (playerId: string, factionId: string): number =>
    pfs.get(pfsKey(playerId, factionId)) ?? 0;

  const getMatchupEffect = (
    factionXId: string,
    factionYId: string,
    versionId?: string,
    battleType?: string,
  ): number => {
    if (factionXId === factionYId) return 0; // mirror
    const { key, sign } = meKey(versionId, battleType, factionXId, factionYId);
    return sign * (me.get(key) ?? 0);
  };

  const getBattleTypeOffset = (playerId: string, battleType: string): number =>
    bto.get(`${playerId}:${battleType}`) ?? 0;

  const expectedChanceToWin = (
    playerAId: string,
    factionXId: string,
    playerBId: string,
    factionYId: string,
    opts?: { battleType?: string; versionId?: string },
  ): number => {
    const bt = opts?.battleType;
    const adv =
      getPlayerFactionSkill(playerAId, factionXId) +
      (bt ? getBattleTypeOffset(playerAId, bt) : 0) -
      getPlayerFactionSkill(playerBId, factionYId) -
      (bt ? getBattleTypeOffset(playerBId, bt) : 0) +
      getMatchupEffect(factionXId, factionYId, opts?.versionId, bt);
    return logistic(adv);
  };

  const getGeneralSkill = (playerId: string): GeneralSkillLookup | null => {
    const e = gs.get(playerId);
    if (!e) return null;
    const se = e.stdError;
    return {
      skill: e.generalSkill,
      se,
      confidence: se > 0 ? 1 / (se * se) : 0,
      peakSkill: e.peakSkill,
      peakFactionId: e.peakFactionId,
      gamesCount: e.gamesCount,
      factionsPlayed: e.factionsPlayed,
    };
  };

  const getPeakFactionSkill = (
    playerId: string,
    factions?: readonly string[],
  ): number | null => {
    const e = gs.get(playerId);
    if (!e) return null;
    // No restriction → use the pre-computed peak across all played factions.
    if (!factions || factions.length === 0) return e.peakSkill;
    // Restricted → recompute the max GS+FO over the allowed factions the player
    // has data for; fall back to the general skill if none overlap.
    let best = Number.NEGATIVE_INFINITY;
    for (const factionId of factions) {
      const s = pfs.get(pfsKey(playerId, factionId));
      if (s !== undefined && s > best) best = s;
    }
    return best === Number.NEGATIVE_INFINITY ? e.generalSkill : best;
  };

  const getBattleTypeSkill = (playerId: string, battleType: string): number | null => {
    const e = gs.get(playerId);
    if (!e) return null;
    return e.generalSkill + getBattleTypeOffset(playerId, battleType);
  };

  return {
    ...data,
    getPlayerFactionSkill,
    getMatchupEffect,
    expectedChanceToWin,
    getGeneralSkill,
    getPeakFactionSkill,
    getBattleTypeOffset,
    getBattleTypeSkill,
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

  // Hierarchical (general-skill) fit is a separate code path so the flat model
  // stays bit-exact as a baseline for the impact comparison / gated rollout.
  if (cfg.hierarchical) return fitHierarchicalRatingModel(observations, cfg);

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
      const { key, sign } = meKey(o.versionId, o.battleType, o.factionXId, o.factionYId);
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
    const { versionId, battleType, factionXId, factionYId } = splitMeKey(key);
    matchupEffects.push({
      factionXId,
      factionYId,
      effect: theta[nPfs + idx]!,
      sampleSize: meSamples[idx]!,
      lowSampleWarning: meSamples[idx]! < cfg.lowSampleThreshold,
      versionId,
      battleType,
    });
  }

  return createRatingModel({
    playerFactionSkills,
    matchupEffects,
    generalSkills: [], // flat model has no general-skill decomposition
    battleTypeOffsets: [], // flat model has no battle-type level
    fitIterations: iter,
    finalLoss: loss,
    totalMatches: observations.length,
  });
}

// ---------------------------------------------------------------------------
// Hierarchical fit — PFS(player, faction) = GS(player) + FO(player, faction)
//
// Same log-loss as the flat model (it only depends on the sum GS+FO and ME), but
// GS is lightly regularised and FO strongly, so a player's per-faction skill is
// shrunk toward their OWN general skill rather than toward the global average.
// theta layout: [ GS(0..nGs) | FO(0..nFo) | ME(0..nMe) ].
// ---------------------------------------------------------------------------

function fitHierarchicalRatingModel(
  observations: MatchObservation[],
  cfg: RatingModelConfig,
): RatingModel {
  // --- 1. Sparse indices: GS per player, FO per (player, faction), ME per pair -
  const gsKeyToIdx = new Map<string, number>(); // key = playerId
  const gsGames: number[] = [];
  const btoKeyToIdx = new Map<string, number>(); // key = playerId:battleType
  const btoGames: number[] = [];
  const foKeyToIdx = new Map<string, number>(); // key = playerId:factionId
  const foGames: number[] = [];
  const meKeyToIdx = new Map<string, number>();
  const meSamples: number[] = [];

  const registerGs = (playerId: string): number => {
    let idx = gsKeyToIdx.get(playerId);
    if (idx === undefined) {
      idx = gsKeyToIdx.size;
      gsKeyToIdx.set(playerId, idx);
      gsGames.push(0);
    }
    gsGames[idx]! += 1;
    return idx;
  };
  const registerBto = (key: string): number => {
    let idx = btoKeyToIdx.get(key);
    if (idx === undefined) {
      idx = btoKeyToIdx.size;
      btoKeyToIdx.set(key, idx);
      btoGames.push(0);
    }
    btoGames[idx]! += 1;
    return idx;
  };
  const registerFo = (key: string): number => {
    let idx = foKeyToIdx.get(key);
    if (idx === undefined) {
      idx = foKeyToIdx.size;
      foKeyToIdx.set(key, idx);
      foGames.push(0);
    }
    foGames[idx]! += 1;
    return idx;
  };

  const compiled = observations.map((o) => {
    const gsA = registerGs(o.playerAId);
    const gsB = registerGs(o.playerBId);
    const btoA = o.battleType !== undefined ? registerBto(`${o.playerAId}:${o.battleType}`) : -1;
    const btoB = o.battleType !== undefined ? registerBto(`${o.playerBId}:${o.battleType}`) : -1;
    const foA = registerFo(pfsKey(o.playerAId, o.factionXId));
    const foB = registerFo(pfsKey(o.playerBId, o.factionYId));

    let meIdx = -1;
    let meSign = 0;
    if (o.factionXId !== o.factionYId) {
      const { key, sign } = meKey(o.versionId, o.battleType, o.factionXId, o.factionYId);
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
    return { gsA, gsB, btoA, btoB, foA, foB, meIdx, meSign, y: o.aWon ? 1 : 0 };
  });

  const nGs = gsKeyToIdx.size;
  const nBto = btoKeyToIdx.size;
  const nFo = foKeyToIdx.size;
  const nMe = meKeyToIdx.size;
  const len = nGs + nBto + nFo + nMe;
  const btoBase = nGs;
  const foBase = nGs + nBto;
  const meBase = nGs + nBto + nFo;

  const theta = new Float64Array(len);
  const grad = new Float64Array(len);
  const m = new Float64Array(len);
  const v = new Float64Array(len);

  const {
    lambdaGeneralSkill: lGs,
    lambdaBattleTypeOffset: lBto,
    lambdaFactionOffset: lFo,
    lambdaMatchup: lMe,
    learningRate: lr,
  } = cfg;

  // --- 2. Adam optimisation --------------------------------------------------
  let loss = 0;
  let prevLoss = Number.POSITIVE_INFINITY;
  let iter = 0;

  for (let t = 1; t <= cfg.maxIterations; t++) {
    iter = t;
    grad.fill(0);
    loss = 0;

    for (const c of compiled) {
      let adv = theta[c.gsA]! + theta[foBase + c.foA]! - theta[c.gsB]! - theta[foBase + c.foB]!;
      if (c.btoA >= 0) adv += theta[btoBase + c.btoA]!;
      if (c.btoB >= 0) adv -= theta[btoBase + c.btoB]!;
      if (c.meIdx >= 0) adv += c.meSign * theta[meBase + c.meIdx]!;

      const p = clampProb(logistic(adv));
      loss += -(c.y * Math.log(p) + (1 - c.y) * Math.log(1 - p));

      const r = p - c.y; // ∂loss/∂adv
      grad[c.gsA]! += r; // ∂adv/∂GS_A = +1
      if (c.btoA >= 0) grad[btoBase + c.btoA]! += r; // ∂adv/∂BTO_A = +1
      grad[foBase + c.foA]! += r; // ∂adv/∂FO_A = +1
      grad[c.gsB]! -= r; // ∂adv/∂GS_B = -1
      if (c.btoB >= 0) grad[btoBase + c.btoB]! -= r; // ∂adv/∂BTO_B = -1
      grad[foBase + c.foB]! -= r; // ∂adv/∂FO_B = -1
      if (c.meIdx >= 0) grad[meBase + c.meIdx]! += c.meSign * r;
    }

    // L2 blocks: GS (light) · BTO (medium) · FO (heavy) · ME
    for (let i = 0; i < nGs; i++) {
      loss += lGs * theta[i]! * theta[i]!;
      grad[i]! += 2 * lGs * theta[i]!;
    }
    for (let i = btoBase; i < foBase; i++) {
      loss += lBto * theta[i]! * theta[i]!;
      grad[i]! += 2 * lBto * theta[i]!;
    }
    for (let i = foBase; i < meBase; i++) {
      loss += lFo * theta[i]! * theta[i]!;
      grad[i]! += 2 * lFo * theta[i]!;
    }
    for (let i = meBase; i < len; i++) {
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

  // --- 3. Fisher-information diagonal → standard errors -----------------------
  // Diagonal Gauss–Newton / Fisher approximation. For each parameter θ_k:
  //   FisherDiag[k] = Σ_obs w_i·(∂adv/∂θ_k)² + 2λ_k,   w_i = p_i·(1−p_i)
  // Derivatives are ±1, so each observation adds w_i to every parameter it
  // touches. SE = 1/√FisherDiag → shrinks with #games and opponent anchoring.
  const fisher = new Float64Array(len);
  for (const c of compiled) {
    let adv = theta[c.gsA]! + theta[foBase + c.foA]! - theta[c.gsB]! - theta[foBase + c.foB]!;
    if (c.btoA >= 0) adv += theta[btoBase + c.btoA]!;
    if (c.btoB >= 0) adv -= theta[btoBase + c.btoB]!;
    if (c.meIdx >= 0) adv += c.meSign * theta[meBase + c.meIdx]!;
    const p = clampProb(logistic(adv));
    const w = p * (1 - p);
    fisher[c.gsA]! += w;
    if (c.btoA >= 0) fisher[btoBase + c.btoA]! += w;
    fisher[foBase + c.foA]! += w;
    fisher[c.gsB]! += w;
    if (c.btoB >= 0) fisher[btoBase + c.btoB]! += w;
    fisher[foBase + c.foB]! += w;
    if (c.meIdx >= 0) fisher[meBase + c.meIdx]! += w;
  }
  for (let i = 0; i < nGs; i++) fisher[i]! += 2 * lGs;
  for (let i = btoBase; i < foBase; i++) fisher[i]! += 2 * lBto;
  for (let i = foBase; i < meBase; i++) fisher[i]! += 2 * lFo;
  for (let i = meBase; i < len; i++) fisher[i]! += 2 * lMe;
  const seOf = (idx: number): number => {
    const d = fisher[idx]!;
    return d > 0 ? 1 / Math.sqrt(d) : Number.POSITIVE_INFINITY;
  };

  // --- 4. Assemble serialisable result ---------------------------------------
  // playerFactionSkills store the SUM GS+FO so every existing consumer
  // (expectedChanceToWin, proficiency) keeps working unchanged — only realer.
  const playerFactionSkills: PlayerFactionSkillEntry[] = [];
  const peak = new Map<string, { skill: number; factionId: string }>();
  for (const [key, idx] of foKeyToIdx) {
    const [playerId, factionId] = splitPfsKey(key);
    const gsIdx = gsKeyToIdx.get(playerId)!;
    const sum = theta[gsIdx]! + theta[foBase + idx]!;
    // Var(GS+FO) ≈ Var(GS)+Var(FO) under the diagonal (independence) approximation.
    const varSum = 1 / fisher[gsIdx]! + 1 / fisher[foBase + idx]!;
    playerFactionSkills.push({
      playerId,
      factionId,
      skill: sum,
      gamesCount: foGames[idx]!,
      lowSampleWarning: foGames[idx]! < cfg.lowSampleThreshold,
      stdError: Math.sqrt(varSum),
    });
    const cur = peak.get(playerId);
    if (!cur || sum > cur.skill) peak.set(playerId, { skill: sum, factionId });
  }

  const factionsPerPlayer = new Map<string, number>();
  for (const key of foKeyToIdx.keys()) {
    const [playerId] = splitPfsKey(key);
    factionsPerPlayer.set(playerId, (factionsPerPlayer.get(playerId) ?? 0) + 1);
  }

  const generalSkills: GeneralSkillEntry[] = [];
  for (const [playerId, gsIdx] of gsKeyToIdx) {
    const gsVal = theta[gsIdx]!;
    const pk = peak.get(playerId);
    generalSkills.push({
      playerId,
      generalSkill: gsVal,
      stdError: seOf(gsIdx),
      peakSkill: pk ? pk.skill : gsVal,
      peakFactionId: pk ? pk.factionId : null,
      gamesCount: gsGames[gsIdx]!,
      factionsPlayed: factionsPerPlayer.get(playerId) ?? 0,
    });
  }

  const matchupEffects: MatchupEffectEntry[] = [];
  for (const [key, idx] of meKeyToIdx) {
    const { versionId, battleType, factionXId, factionYId } = splitMeKey(key);
    matchupEffects.push({
      factionXId,
      factionYId,
      effect: theta[meBase + idx]!,
      sampleSize: meSamples[idx]!,
      lowSampleWarning: meSamples[idx]! < cfg.lowSampleThreshold,
      versionId,
      battleType,
    });
  }

  const battleTypeOffsets: BattleTypeOffsetEntry[] = [];
  for (const [key, idx] of btoKeyToIdx) {
    const [playerId, battleType] = splitPfsKey(key); // key = playerId:battleType
    battleTypeOffsets.push({
      playerId,
      battleType,
      offset: theta[btoBase + idx]!,
      gamesCount: btoGames[idx]!,
      stdError: seOf(btoBase + idx),
    });
  }

  return createRatingModel({
    playerFactionSkills,
    matchupEffects,
    generalSkills,
    battleTypeOffsets,
    fitIterations: iter,
    finalLoss: loss,
    totalMatches: observations.length,
  });
}

// ---------------------------------------------------------------------------
// Skill → band mapping
// ---------------------------------------------------------------------------

/**
 * Band cut-points on the general-skill (log-odds) scale. Band 1 = New … 5 = Top.
 * Calibrated with Alex (2026-07-01) against the real fitted-skill distribution,
 * expressed as win-chance vs the average active player: 20% / 35% / 75% / 90%.
 * logit(p) = ln(p/(1-p)):
 *   20% → -1.3863 · 35% → -0.6190 · 75% → 1.0986 · 90% → 2.1972
 */
export const SKILL_BAND_THRESHOLDS = [-1.3863, -0.619, 1.0986, 2.1972] as const;

/** Map a general-skill (log-odds) value to a 1..5 band. */
export function skillToBand(skill: number): number {
  let band = 1;
  for (const t of SKILL_BAND_THRESHOLDS) {
    if (skill >= t) band += 1;
  }
  return band;
}
