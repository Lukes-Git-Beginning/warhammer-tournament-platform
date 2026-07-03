// ---------------------------------------------------------------------------
// Skill classification — questionnaire + data → skill band (Alex-spec, N2).
//
// Two sources are combined into one band (1 New … 5 Top):
//   - Cold-start questionnaire (§3b) → a conservative-up "floor" band.
//   - On-platform data → the hierarchical general skill (GS) + its Fisher SE.
//
// Two outputs, for two uses (co-designed 2026-07-01):
//   - MATCHMAKING (Balanced Liechtenstein): the Bayes-blended posterior skill —
//     questionnaire as prior, each game as evidence weighted by Fisher info.
//     0 games → questionnaire leads; many games → data leads.
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

export interface CalibrationQuestion {
  id: string;
  /** Heaviest (most discriminating) questions first — drives the adaptive early-exit order. */
  prompt: string;
  options: QuestionOption[];
}

/**
 * Strongest-first: Q3 (verifiable results) and Q2 (tournament tier) classify
 * experienced players in 1–2 clicks. Volume/proxy questions cap at band 3 —
 * bands 4–5 are only reachable via Q3 (achievements) or Q12 (self-claim), so no
 * one can grind/proxy their way to Advanced/Elite.
 */
export const CALIBRATION_QUESTIONS: CalibrationQuestion[] = [
  {
    id: 'best_result',
    prompt: 'Your best competitive tournament result?',
    options: [
      { value: 'none', label: 'Never made semifinals', floor: null },
      { value: 'semis_npt_ipt', label: 'Semis or win at a new-player / intermediate tournament', floor: 3 },
      { value: 'won_open', label: 'Won an open tournament (top players active)', floor: 4 },
      { value: 'tt_top16', label: 'Finished a TT season in the Top 16 / Grand Finals', floor: 5 },
    ],
  },
  {
    id: 'tournament_types',
    prompt: 'What kind of tournaments have you played?',
    options: [
      { value: 'none', label: 'None yet', floor: null },
      { value: 'npt', label: 'New-player tournaments (NPT)', floor: 2 },
      { value: 'ipt', label: 'Intermediate tournaments (IPT)', floor: 3 },
      { value: 'open', label: 'Open / competitive tournaments', floor: 3 },
    ],
  },
  {
    id: 'ranked_level',
    prompt: 'Your highest in-game ranked level?',
    options: [
      { value: 'never_casual', label: 'Never ranked / casual only', floor: 1 },
      { value: 'lower_mid', label: 'Lower to mid ranked', floor: 2 },
      { value: 'high', label: 'High ranked', floor: 3 },
      { value: 'top_ladder', label: 'Top of the ladder', floor: 3 },
    ],
  },
  {
    id: 'total_battles',
    prompt: 'Total multiplayer battles (Land Battle + Domination + Custom)?',
    options: [
      { value: 'lt50', label: 'Fewer than 50', floor: null },
      { value: '50_200', label: '50–200', floor: 2 },
      { value: '200_1000', label: '200–1000', floor: 3 },
      { value: 'gt1000', label: '1000+', floor: 3 },
    ],
  },
  {
    id: 'domination_battles',
    prompt: 'Domination-specific battles?',
    options: [
      { value: 'lt10', label: 'Fewer than 10', floor: null },
      { value: '10_50', label: '10–50', floor: 2 },
      { value: '50_200', label: '50–200', floor: 2 },
      { value: 'gt200', label: '200+', floor: 3 },
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
    id: 'meta_familiarity',
    prompt: 'How well do you know the current competitive meta?',
    options: [
      { value: 'barely', label: 'Barely / just the basics', floor: null },
      { value: 'solid', label: 'Solid understanding', floor: 2 },
      { value: 'very_good', label: 'Very good', floor: 3 },
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
  {
    id: 'self_rating',
    prompt: 'Where would you place yourself?',
    options: [
      { value: '1', label: 'New — barely any PvP experience', floor: 1 },
      { value: '2', label: 'Beginner — some PvP, never made semis', floor: 2 },
      { value: '3', label: 'Intermediate — semis/wins at NPT/IPT level', floor: 3 },
      { value: '4', label: 'Advanced — won open tournaments', floor: 4 },
      { value: '5', label: 'Top — TT-season Top 16', floor: 5 },
    ],
  },
  {
    // UX-only: intent doesn't affect the band, but tailors messaging.
    id: 'intent',
    prompt: 'What are you here for?',
    options: [
      { value: 'learn', label: 'Learn and improve', floor: null },
      { value: 'compete', label: 'Compete seriously', floor: null },
      { value: 'casual', label: 'Casual fun', floor: null },
    ],
  },
];

const QUESTION_BY_ID = new Map(CALIBRATION_QUESTIONS.map((q) => [q.id, q]));

/**
 * Questionnaire floor = the highest band any answer implies (conservative-up),
 * default 1. Unknown question ids / option values are ignored. `answers` maps
 * question id → chosen option value.
 */
export function questionnaireFloor(answers: Record<string, string>): number {
  let floor = 1;
  for (const [qid, value] of Object.entries(answers)) {
    const opt = QUESTION_BY_ID.get(qid)?.options.find((o) => o.value === value);
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
   * How much the questionnaire "counts", in equivalent games. The prior precision
   * τ_prior = priorEquivGames · INFO_PER_GAME. Higher → data takes longer to
   * overtake the questionnaire. This is the "how fast does data replace the
   * questionnaire" dial Alex asked about.
   */
  priorEquivGames: number;
  /** k in the conservative gating estimate GS − k·SE (higher = harder to over-block). */
  gatingSeMultiplier: number;
}

export const DEFAULT_CLASSIFICATION_CONFIG: ClassificationConfig = {
  // 50 ≈ where data ties the questionnaire (calibrated with Alex 2026-07-01):
  // a New player's first handful of games (often within a beginner bubble) barely
  // move the estimate; only real volume overtakes the self-assessment. Data weight
  // grows as N/(50+N). The real fix for "against whom" is anchoring-aware
  // confidence (a later upgrade); until then this errs conservative.
  priorEquivGames: 50,
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
  const priorTau = cfg.priorEquivGames * INFO_PER_GAME;

  const hasData = data.generalSkill != null && data.stdError != null && data.stdError > 0;

  // --- Matchmaking: Bayes precision-weighted blend --------------------------
  let postMu: number;
  let postTau: number;
  if (hasData) {
    const dataMu = data.generalSkill!;
    const dataTau = 1 / (data.stdError! * data.stdError!); // Fisher info = 1/SE²
    postTau = priorTau + dataTau;
    postMu = (priorTau * priorMu + dataTau * dataMu) / postTau;
  } else {
    postMu = priorMu;
    postTau = priorTau;
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
