// ---------------------------------------------------------------------------
// Skill classification — questionnaire + data → skill band (Alex-spec, N2).
//
// Two sources are combined into one band (1 New … 5 Top):
//   - Cold-start questionnaire (§3b) → a conservative-up "floor" band.
//   - On-platform data → the hierarchical general skill (GS) + its Fisher SE.
//
// Two outputs, for two uses (co-designed 2026-07-01):
//   - MATCHMAKING (Balanced Liechtenstein): the Bayes-blended posterior skill —
//     questionnaire as an ASYMMETRIC soft-floor prior, each game as Fisher-weighted
//     evidence. Data above the claim overtakes fast (~10 games), data below is resisted
//     (~60). 0 games → questionnaire leads; many games → data leads.
//   - GATING (beginner/intermediate formats): MAX(questionnaire floor,
//     conservative data band). Conservative = skillToBand(GS − 2·SE), so thin
//     data can never over-block a newcomer, but confident strength always does.
//     Only ever moves UP (never auto-down); down-correction is host-override.
//
// The band cut-points live in rating-model.ts (SKILL_BAND_THRESHOLDS), calibrated
// with Alex to 20/35/75/90% win-chance vs the average active player.
// ---------------------------------------------------------------------------

import { skillToBand, SKILL_BAND_THRESHOLDS, logistic } from './rating-model.js';

// ---------------------------------------------------------------------------
// Questionnaire catalog (§3b — FINALISED with Alex 2026-06-29)
// ---------------------------------------------------------------------------

/** Human-readable band names, indexed 1..5 (index 0 unused). */
export const BAND_NAMES = ['', 'New', 'Beginner', 'Intermediate', 'Advanced', 'Top'] as const;

/** A single answer option. `floor` is the minimum band this answer implies (null = no signal). */
export interface QuestionOption {
  value: string;
  label: string;
  floor: number | null;
}

/** The battle types a skill/band can be judged in (mirrors the Prisma BattleType enum). */
export const SKILL_BATTLE_TYPES = ['DOMINATION', 'CONQUEST', 'SIEGE'] as const;
export type SkillBattleType = (typeof SKILL_BATTLE_TYPES)[number];
/** A classification scope: one battle type, or OVERALL (the game-weighted summary). */
export type SkillScope = 'OVERALL' | SkillBattleType;

/** Display label for a battle type (user-facing copy: "Conquest", not "CONQUEST"). */
export function battleTypeLabel(type: SkillBattleType): string {
  return type.charAt(0) + type.slice(1).toLowerCase();
}

export interface CalibrationQuestion {
  id: string;
  /** Heaviest (most discriminating) questions first — drives the adaptive early-exit order. */
  prompt: string;
  options: QuestionOption[];
  /**
   * The battle types this question speaks to. Absent/empty = GENERAL (counts toward every
   * type's floor). A type's floor only ever comes from its own questions + the general ones —
   * no transfer between types (Alex, 2026-10-08).
   */
  battleTypes?: SkillBattleType[];
}

// Conquest and Siege are asked the same way (same shapes/floors) — built from these templates.
function typeBestResult(type: SkillBattleType, label: string): CalibrationQuestion {
  return {
    id: `${type.toLowerCase()}_best_result`,
    prompt: `What is your highest ${label} tournament achievement?`,
    battleTypes: [type],
    options: [
      { value: 'none', label: `Never made the semifinals of a ${label} tournament.`, floor: null },
      { value: 'semis_restricted', label: `Reached the semifinals of a beginner / restricted ${label} tournament.`, floor: 2 },
      { value: 'won_restricted', label: `Won a beginner / restricted ${label} tournament, or made the semifinals of an open one.`, floor: 3 },
      { value: 'won_open', label: `Won an open / unrestricted ${label} tournament.`, floor: 4 },
      { value: 'major', label: `Won a major ${label} event or finished at the top of a ${label} season.`, floor: 5 },
    ],
  };
}
function typeBattles(type: SkillBattleType, label: string): CalibrationQuestion {
  return {
    id: `${type.toLowerCase()}_battles`,
    prompt: `Total multiplayer battles played (${label} only)?`,
    battleTypes: [type],
    options: [
      { value: 'lt10', label: 'Fewer than 10', floor: null },
      { value: '10_50', label: '10–50', floor: 1 },
      { value: '50_200', label: '50–200', floor: 2 },
      { value: 'gt200', label: '200+', floor: 3 },
    ],
  };
}
function typeRanked(type: SkillBattleType, id: string, label: string): CalibrationQuestion {
  return {
    id,
    prompt: `Your performance on CA's Ranked Matchmaking in ${label}?`,
    battleTypes: [type],
    options: [
      { value: 'never_casual', label: 'Never ranked / casual only', floor: 1 },
      { value: 'lower_mid', label: 'Lower to mid-ranked', floor: 2 },
      { value: 'high', label: 'High-ranked', floor: 3 },
      { value: 'top_ladder', label: 'Top of the ladder (just below the cheaters)', floor: 4 },
    ],
  };
}
function typeSelfRating(type: SkillBattleType, label: string): CalibrationQuestion {
  return {
    id: `${type.toLowerCase()}_self_rating`,
    prompt: `Where would you place yourself in ${label}?`,
    battleTypes: [type],
    options: [
      { value: '1', label: `New — barely any ${label} experience`, floor: 1 },
      { value: '2', label: `Beginner — some ${label} battles, still learning`, floor: 2 },
      { value: '3', label: `Intermediate — I hold my own in ${label} tournaments`, floor: 3 },
      { value: '4', label: `Advanced — I win ${label} tournaments`, floor: 4 },
      { value: '5', label: `Top — among the very best ${label} players`, floor: 5 },
    ],
  };
}

/**
 * Grouped per battle type, strongest-first within each type: the achievement question
 * (best_result) and tournament tier classify experienced players in 1–2 clicks. Most
 * volume/proxy questions cap at band 3; the only routes to band 4 are a real achievement,
 * top-of-ladder ranked play, or the self-rating, and band 5 is only reachable via the
 * achievement or the self-rating — so no one can grind low-signal volume answers up to
 * Advanced/Top. Every type is asked (Alex, 2026-10-08); the general block comes last and
 * feeds every type's floor.
 *
 * The Domination ids are the original (pre-battle-type) ids, so existing answers keep
 * counting — they now count for Domination only.
 */
export const CALIBRATION_QUESTIONS: CalibrationQuestion[] = [
  // --- Domination ---
  {
    id: 'best_result',
    prompt: 'What is your highest Domination tournament achievement?',
    battleTypes: ['DOMINATION'],
    options: [
      { value: 'none', label: 'Never made semifinals.', floor: null },
      { value: 'semis_npt', label: 'Reached semis in a New Player Tournament.', floor: 2 },
      { value: 'semis_npt_ipt', label: 'Won a New Player Tournament / made semis in an Intermediate Tournament.', floor: 3 },
      { value: 'won_open', label: "Won an unrestricted tournament on Total Tavern or RizzOtto's Arena.", floor: 4 },
      { value: 'tt_top16', label: 'Finished a TT season in the Top 16 and/or made Grand Finals.', floor: 5 },
    ],
  },
  {
    id: 'tournament_types',
    prompt: 'What kinds of Domination tournaments have you played?',
    battleTypes: ['DOMINATION'],
    options: [
      { value: 'none', label: 'None yet', floor: null },
      { value: 'npt', label: 'New Player Tournaments (NPT)', floor: 1 },
      { value: 'ipt', label: 'Intermediate Player Tournaments (IPT)', floor: 2 },
      { value: 'open', label: 'Open / unrestricted tournaments', floor: 3 },
    ],
  },
  typeRanked('DOMINATION', 'ranked_level', 'Domination'),
  {
    id: 'domination_battles',
    prompt: 'Total multiplayer battles played (Domination only)?',
    battleTypes: ['DOMINATION'],
    options: [
      { value: 'lt10', label: 'Fewer than 10', floor: null },
      { value: '10_50', label: '10–50', floor: 1 },
      { value: '50_200', label: '50–200', floor: 2 },
      { value: 'gt200', label: '200+', floor: 3 },
    ],
  },
  {
    id: 'meta_familiarity',
    prompt: 'How well do you know the current competitive Domination meta?',
    battleTypes: ['DOMINATION'],
    options: [
      { value: 'barely', label: 'Barely / just the basics', floor: null },
      { value: 'solid', label: 'Solid understanding', floor: 2 },
      { value: 'very_good', label: 'Very good', floor: 3 },
    ],
  },
  {
    id: 'self_rating',
    prompt: 'Where would you place yourself in Domination?',
    battleTypes: ['DOMINATION'],
    options: [
      { value: '1', label: 'New — barely any PvP experience', floor: 1 },
      { value: '2', label: 'Beginner — some PvP, some tournament experience', floor: 2 },
      { value: '3', label: 'Intermediate — semis at IPT/wins at NPT/IPT level', floor: 3 },
      { value: '4', label: 'Advanced — won open/unrestricted tournaments', floor: 4 },
      { value: '5', label: 'Top — TT-season Top 16', floor: 5 },
    ],
  },
  // --- Conquest (CA Ranked has a Conquest queue) ---
  typeBestResult('CONQUEST', 'Conquest'),
  typeRanked('CONQUEST', 'conquest_ranked', 'Conquest'),
  typeBattles('CONQUEST', 'Conquest'),
  typeSelfRating('CONQUEST', 'Conquest'),
  // --- Siege (not in CA Ranked → no ranked question) ---
  typeBestResult('SIEGE', 'Siege'),
  typeBattles('SIEGE', 'Siege'),
  typeSelfRating('SIEGE', 'Siege'),
  // --- General: feeds every type's floor; volume/proxy questions, cap at band 3 ---
  {
    id: 'total_battles',
    prompt: 'Total multiplayer battles played (Land Battle + Domination + Conquest)?',
    options: [
      { value: 'lt50', label: 'Fewer than 50', floor: null },
      { value: '50_200', label: '50–200', floor: 2 },
      { value: '200_1000', label: '200–1000', floor: 3 },
      { value: 'gt1000', label: '1000+', floor: 3 },
    ],
  },
  {
    id: 'years_competitive',
    prompt: 'How long have you played competitively?',
    options: [
      { value: 'lt6mo', label: 'Just started / under 6 months', floor: null },
      { value: '6mo_2y', label: '6 months – 2 years', floor: 2 },
      { value: 'gt2y', label: '2+ years', floor: 3 },
    ],
  },
  {
    id: 'prior_titles',
    prompt: 'Were you competitive in Warhammer II / I?',
    options: [
      { value: 'no', label: 'No', floor: null },
      { value: 'some', label: 'Somewhat', floor: 2 },
      { value: 'serious', label: 'Yes, seriously', floor: 3 },
    ],
  },
  {
    id: 'steam_hours',
    prompt: 'Total Steam hours across Warhammer I + II + III?',
    options: [
      { value: 'lt500', label: 'Under 500', floor: null },
      { value: '500_1500', label: '500–1500', floor: 2 },
      { value: 'gt1500', label: '1500+', floor: 2 },
    ],
  },
  {
    id: 'community',
    prompt: 'How active are you in the competitive community?',
    options: [
      { value: 'no', label: 'Not really', floor: null },
      { value: 'some', label: 'Somewhat', floor: 2 },
      { value: 'active', label: 'Very active', floor: 3 },
    ],
  },
  {
    id: 'list_building',
    prompt: 'How confident are you at list-building?',
    options: [
      { value: 'templates', label: 'I need templates', floor: null },
      { value: 'okay', label: 'Okay on my own', floor: 2 },
      { value: 'confident', label: 'Very confident', floor: 2 },
    ],
  },
];

/** True when `question` feeds the floor of `scope` (OVERALL = every question). */
export function questionAppliesTo(question: CalibrationQuestion, scope: SkillScope): boolean {
  if (scope === 'OVERALL') return true;
  return !question.battleTypes || question.battleTypes.length === 0 || question.battleTypes.includes(scope);
}

/**
 * Battle types the player has NOT been asked about yet: a calibrated player (any answer) with
 * no answer to any question scoped to that type. Drives the "answer a few Conquest/Siege
 * questions" banner for players who calibrated before the battle-type questionnaire existed.
 */
export function pendingCalibrationTypes(
  answers: Record<string, string>,
  questions: readonly CalibrationQuestion[] = CALIBRATION_QUESTIONS,
): SkillBattleType[] {
  if (Object.keys(answers).length === 0) return []; // not calibrated at all → the normal CTA
  return SKILL_BATTLE_TYPES.filter((type) => {
    const typed = questions.filter((q) => q.battleTypes?.includes(type));
    return typed.length > 0 && !typed.some((q) => answers[q.id] != null);
  });
}

/**
 * Questionnaire floor = the highest band any answer implies (conservative-up),
 * default 1. Unknown question ids / option values are ignored. `answers` maps
 * question id → chosen option value. Pass a custom `questions` catalog (e.g. the
 * admin-edited one from the DB); defaults to the built-in catalog.
 *
 * `scope` restricts the floor to one battle type: only that type's questions + the general
 * ones count. OVERALL (default) = every answer, the pre-battle-type behaviour.
 */
export function questionnaireFloor(
  answers: Record<string, string>,
  questions: readonly CalibrationQuestion[] = CALIBRATION_QUESTIONS,
  scope: SkillScope = 'OVERALL',
): number {
  const byId = new Map(questions.map((q) => [q.id, q]));
  let floor = 1;
  for (const [qid, value] of Object.entries(answers)) {
    const q = byId.get(qid);
    if (!q || !questionAppliesTo(q, scope)) continue;
    const opt = q.options.find((o) => o.value === value);
    if (opt?.floor != null && opt.floor > floor) floor = opt.floor;
  }
  return floor;
}

// ---------------------------------------------------------------------------
// Prior mapping — a questionnaire band → a point estimate on the log-odds scale
// ---------------------------------------------------------------------------

/**
 * Representative log-odds skill for each band (index 1..5), used as the Bayes
 * prior mean μ. Interior bands use the midpoint of their calibrated interval;
 * the open-ended bands 1 and 5 use a sensible representative point.
 *   1≈12% · 2≈27% · 3≈56% · 4≈84% · 5≈94%
 */
export const BAND_MIDPOINT_LOGODDS: readonly number[] = (() => {
  const t = SKILL_BAND_THRESHOLDS; // [b1|b2, b2|b3, b3|b4, b4|b5]
  return [
    Number.NaN, // index 0 unused
    t[0]! - 0.6, // band 1 (open below): a bit under the 20% cut
    (t[0]! + t[1]!) / 2, // band 2 midpoint
    (t[1]! + t[2]!) / 2, // band 3 midpoint
    (t[2]! + t[3]!) / 2, // band 4 midpoint
    t[3]! + 0.5, // band 5 (open above): a bit over the 90% cut
  ];
})();

export function bandToLogOdds(band: number): number {
  const b = Math.min(5, Math.max(1, Math.round(band)));
  return BAND_MIDPOINT_LOGODDS[b]!;
}

// ---------------------------------------------------------------------------
// Tunable constants (AdminConfig-ready — defaults here)
// ---------------------------------------------------------------------------

export interface ClassificationConfig {
  /**
   * Asymmetric "soft floor" — how much the questionnaire counts, in equivalent games,
   * split by whether the data lands ABOVE or BELOW the questionnaire band. Prior precision
   * τ_prior = priorEquivGames · INFO_PER_GAME; data weight grows as N/(priorEquivGames+N).
   * A small ABOVE value lets a player who out-performs their claim climb fast (catches
   * sandbaggers); a large BELOW value makes the questionnaire resist a downward drift, so a
   * bad run only slowly pulls a player under their own claim.
   */
  priorEquivGamesAbove: number;
  priorEquivGamesBelow: number;
  /** k in the conservative gating estimate GS − k·SE (higher = harder to over-block). */
  gatingSeMultiplier: number;
}

export const DEFAULT_CLASSIFICATION_CONFIG: ClassificationConfig = {
  // Asymmetric soft floor (Alex, 2026-08-21): a player performing ABOVE their questionnaire
  // ties the claim in ~10 games and dominates by ~30 (fast up — catches sandbaggers); one
  // performing BELOW it needs ~60 games to tie and ~180 to reach 75% data weight (slow down —
  // the questionnaire is a floor that data only slowly falls through). This ONLY drives the
  // matchmaking/recognized band; the gating (tournament-entry) band below is unchanged. The
  // real fix for "against whom" is anchoring-aware confidence (a later upgrade).
  priorEquivGamesAbove: 10,
  priorEquivGamesBelow: 60,
  gatingSeMultiplier: 2,
};

// Fisher information of one balanced game ≈ p(1−p) at p=0.5.
const INFO_PER_GAME = 0.25;

// ---------------------------------------------------------------------------
// Bayes blend + classification
// ---------------------------------------------------------------------------

export interface DataSkill {
  /** General skill (log-odds); null when the player has no fitted GS yet. */
  generalSkill: number | null;
  /** Standard error of the general skill (from Fisher info). */
  stdError: number | null;
}

export interface Classification {
  /** Blended posterior skill (log-odds) — the realistic estimate for matchmaking. */
  matchmakingSkill: number;
  /** Band of the blended posterior (1..5). */
  matchmakingBand: number;
  /** Gating band = MAX(questionnaire floor, conservative data band). For format gates. */
  gatingBand: number;
  /** Questionnaire-only floor (1..5). */
  questionnaireFloor: number;
  /** Posterior standard error (confidence of the matchmaking skill). */
  posteriorSe: number;
  /** True when confident data exceeds the questionnaire claim → sandbag/smurf suspicion. */
  smurfSuspected: boolean;
}

/**
 * Combine the questionnaire floor and the on-platform data into the two skill
 * views. `data.generalSkill` null (no games) → the result is questionnaire-only.
 */
export function classify(
  qFloor: number,
  data: DataSkill,
  config: Partial<ClassificationConfig> = {},
): Classification {
  const cfg = { ...DEFAULT_CLASSIFICATION_CONFIG, ...config };
  const priorMu = bandToLogOdds(qFloor);

  const hasData = data.generalSkill != null && data.stdError != null && data.stdError > 0;

  // --- Matchmaking: Bayes blend with an ASYMMETRIC soft floor ---------------
  // The questionnaire is a soft floor, not a symmetric anchor: data ABOVE the claimed band
  // overtakes it fast (small prior weight), data BELOW is resisted (large prior weight).
  // Only the matchmaking/recognized band uses this; the gating band below is unaffected.
  let postMu: number;
  let postTau: number;
  if (hasData) {
    const dataMu = data.generalSkill!;
    const dataTau = 1 / (data.stdError! * data.stdError!); // Fisher info = 1/SE²
    const priorEquivGames = dataMu >= priorMu ? cfg.priorEquivGamesAbove : cfg.priorEquivGamesBelow;
    const priorTau = priorEquivGames * INFO_PER_GAME;
    postTau = priorTau + dataTau;
    postMu = (priorTau * priorMu + dataTau * dataMu) / postTau;
  } else {
    postMu = priorMu;
    postTau = cfg.priorEquivGamesBelow * INFO_PER_GAME; // questionnaire-only confidence
  }
  const posteriorSe = 1 / Math.sqrt(postTau);

  // --- Gating: conservative anti-sandbag MAX --------------------------------
  // Data only raises the gate when it's confidently high: GS − k·SE above a cut.
  const conservativeDataBand = hasData
    ? skillToBand(data.generalSkill! - cfg.gatingSeMultiplier * data.stdError!)
    : 1;
  const gatingBand = Math.max(qFloor, conservativeDataBand);

  return {
    matchmakingSkill: postMu,
    matchmakingBand: skillToBand(postMu),
    gatingBand,
    questionnaireFloor: qFloor,
    posteriorSe,
    // Sandbag/smurf: confident data lands strictly above the claimed floor.
    smurfSuspected: hasData && conservativeDataBand > qFloor,
  };
}

/** Win-chance (0..1) of a skill value vs the average active player — for display. */
export function skillToWinChance(logOdds: number): number {
  return logistic(logOdds);
}

/**
 * Bayes-blend a continuous prior skill (log-odds) with observed data (a fitted GS + its
 * Fisher SE), weighting the prior as `priorEquivGames` balanced games. With no data the
 * estimate is the prior; as decisive games accumulate (SE shrinks) it slides to the data.
 *
 * The 2v2 team-GS cold-start (Alex 2026-09-12): prior = the two members' average individual
 * GS, data = the team's own fitted 2v2 GS — so a brand-new duo starts at its members' strength
 * and converges to its real team rating as it plays. Symmetric (unlike the questionnaire
 * soft-floor in classify(), there is no sandbag direction to resist here).
 */
export function blendSkill(
  priorMu: number,
  data: DataSkill,
  priorEquivGames: number,
): { skill: number; se: number } {
  const priorTau = priorEquivGames * INFO_PER_GAME;
  if (data.generalSkill == null || data.stdError == null || data.stdError <= 0) {
    return { skill: priorMu, se: 1 / Math.sqrt(priorTau) };
  }
  const dataTau = 1 / (data.stdError * data.stdError);
  const postTau = priorTau + dataTau;
  return {
    skill: (priorTau * priorMu + dataTau * data.generalSkill) / postTau,
    se: 1 / Math.sqrt(postTau),
  };
}
