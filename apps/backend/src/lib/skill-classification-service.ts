// ---------------------------------------------------------------------------
// Skill classification service — ties the questionnaire (persisted per user) to
// the live rating model and produces a player's skill classification.
//
// The calibration answers are stored on the user (incrementally). The general
// skill comes from the HIERARCHICAL rating model, requested explicitly here
// regardless of the global rollout flag — classification always needs the GS,
// even while leaderboard points still run on the flat model (pre-launch).
// ---------------------------------------------------------------------------

import type { PrismaClient } from '@rizzotto/db';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { getRatingModel } from './rating-model-service.js';
import type { RatingModel } from './rating-model.js';
import {
  classify,
  questionnaireFloor,
  pendingCalibrationTypes,
  skillToWinChance,
  BAND_NAMES,
  CALIBRATION_QUESTIONS,
  SKILL_BATTLE_TYPES,
  type Classification,
  type CalibrationQuestion,
  type SkillBattleType,
  type SkillScope,
} from './skill-classification.js';

/** Below this many games IN a scope, its skill is shown as provisional (Alex, 2026-10-08). */
export const PROVISIONAL_MIN_GAMES = 5;

// ---------------------------------------------------------------------------
// Admin-editable calibration catalog (stored in AdminConfig, falls back to the
// built-in default). Validated on read so a bad admin edit can never break
// classification — it just reverts to the default catalog.
// ---------------------------------------------------------------------------

export const CALIBRATION_CONFIG_KEY = 'calibration_questions';

export const CalibrationOptionSchema = z.object({
  value: z.string().min(1).max(60),
  label: z.string().min(1).max(200),
  floor: z.number().int().min(1).max(5).nullable(),
});
export const CalibrationQuestionSchema = z.object({
  id: z.string().min(1).max(60),
  prompt: z.string().min(1).max(300),
  options: z.array(CalibrationOptionSchema).min(1).max(12),
  battleTypes: z.array(z.enum(SKILL_BATTLE_TYPES)).optional(),
});
export const CalibrationQuestionsSchema = z
  .array(CalibrationQuestionSchema)
  .min(1)
  .max(40)
  .superRefine((qs, ctx) => {
    const ids = new Set<string>();
    for (const q of qs) {
      if (ids.has(q.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate question id "${q.id}"` });
      ids.add(q.id);
      const values = new Set<string>();
      for (const o of q.options) {
        if (values.has(o.value)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate option "${o.value}" in "${q.id}"` });
        values.add(o.value);
      }
    }
  });

/** The active calibration catalog: the admin-edited one (AdminConfig) or the built-in default. */
export async function loadCalibrationQuestions(prisma: PrismaClient): Promise<CalibrationQuestion[]> {
  const row = await prisma.adminConfig.findUnique({
    where: { key: CALIBRATION_CONFIG_KEY },
    select: { value: true },
  });
  if (!row) return [...CALIBRATION_QUESTIONS];
  const parsed = CalibrationQuestionsSchema.safeParse(row.value);
  return parsed.success ? withBattleTypeScopes(parsed.data) : [...CALIBRATION_QUESTIONS];
}

/**
 * Bring an admin-edited catalog saved BEFORE the battle-type questionnaire up to date, without
 * overriding admin intent: (1) a question with no scope inherits its built-in scope by id
 * (e.g. best_result → Domination); (2) ONLY if the catalog is such a pre-rework edit of the
 * built-in one (some question inherited a scope), a battle type it has NO question for gets the
 * built-in questions of that type appended. A wholly custom catalog (no built-in ids) is left as
 * the admin wrote it, and once an admin saves scoped questions both steps are no-ops.
 */
export function withBattleTypeScopes(stored: CalibrationQuestion[]): CalibrationQuestion[] {
  const builtIn = new Map(CALIBRATION_QUESTIONS.map((q) => [q.id, q]));
  let inherited = false;
  const scoped = stored.map((q) => {
    if (q.battleTypes && q.battleTypes.length > 0) return q;
    const scope = builtIn.get(q.id)?.battleTypes;
    if (scope && scope.length > 0) inherited = true;
    return { ...q, battleTypes: scope };
  });
  if (!inherited) return scoped;
  const ids = new Set(scoped.map((q) => q.id));
  for (const type of SKILL_BATTLE_TYPES) {
    if (scoped.some((q) => q.battleTypes?.includes(type))) continue;
    for (const q of CALIBRATION_QUESTIONS) {
      if (q.battleTypes?.includes(type) && !ids.has(q.id)) {
        scoped.push(q);
        ids.add(q.id);
      }
    }
  }
  return scoped;
}

export interface PlayerClassification extends Classification {
  /** The scope this classification is for: one battle type, or OVERALL (game-weighted summary). */
  scope: SkillScope;
  /**
   * The data skill (log-odds) IN this scope and its SE; null when the player has no games.
   * Overall = game-weighted across battle types; a type = GS + that type's offset.
   * (Field name kept from the pre-battle-type API.)
   */
  generalSkill: number | null;
  generalSkillSe: number | null;
  /** Decisive games in this scope (all games for OVERALL). */
  scopeGames: number;
  /** True when the scope has fewer than PROVISIONAL_MIN_GAMES games — show as "provisional". */
  provisional: boolean;
  /** Win-chance (0..1) of the blended matchmaking skill vs the average player. */
  matchmakingWinChance: number;
  /** Name of the gating band (the player's headline tier). */
  bandName: string;
  /** Whether the player has answered any scoring questions yet. */
  hasQuestionnaire: boolean;
  /** True when there is real signal (questionnaire or fitted data); false = "Unrated". */
  rated: boolean;
  /** Battle types a calibrated player has not been asked about yet (profile banner). */
  pendingCalibrationTypes: SkillBattleType[];
}

/** Read a user's stored calibration answers (question id → option value). */
export async function loadAnswers(
  prisma: PrismaClient,
  playerId: string,
): Promise<Record<string, string>> {
  const user = await prisma.user.findUnique({
    where: { id: playerId },
    select: { calibration_answers: true },
  });
  const raw = user?.calibration_answers;
  return raw && typeof raw === 'object' ? (raw as Record<string, string>) : {};
}

/**
 * The battle type a tournament's skill gate / divisions are judged in. Gating, BaLi divisions
 * and seeding look at how good a player is in THAT type (Alex, 2026-10-07) — not overall.
 */
export function scopeForBattleType(battleType: string | null | undefined): SkillScope {
  return (SKILL_BATTLE_TYPES as readonly string[]).includes(battleType ?? '')
    ? (battleType as SkillBattleType)
    : 'OVERALL';
}

/**
 * PURE (given a fitted model): classify one player in one scope. The batch callers (admin stats,
 * broadcast audiences, the users list) fit the model once and call this per player; the single-
 * player getPlayerClassification wraps it.
 *
 * Data skill per scope comes from model.getSkillEstimate: a type = GS + that type's offset (the
 * offset is shrunk toward 0 with few games, so a player new to a type starts at their general
 * level); OVERALL = game-weighted, NOT the raw base GS (which the fit leaves near the unweighted
 * centroid of the per-type skills — one Conquest game would weigh like hundreds of Domination
 * games). The questionnaire floor only counts that type's questions + the general ones.
 */
export function classifyWithModel(
  model: RatingModel,
  answers: Record<string, string>,
  questions: readonly CalibrationQuestion[],
  playerId: string,
  scope: SkillScope = 'OVERALL',
): PlayerClassification {
  const qFloor = questionnaireFloor(answers, questions, scope);
  const est = model.getSkillEstimate(playerId, scope);
  const result = classify(qFloor, {
    generalSkill: est?.skill ?? null,
    stdError: est?.se ?? null,
  });

  const hasQuestionnaire = Object.keys(answers).length > 0;
  // #18 — "rated" means we have real signal: a questionnaire OR fitted game data.
  // A player with neither is NOT band-1 "New"; the default floor is just a
  // placeholder. Such players are surfaced as "Unrated" and kept out of band stats.
  const rated = hasQuestionnaire || est != null;
  const scopeGames = est?.gamesCount ?? 0;

  return {
    ...result,
    scope,
    // Only a real (self-reported) claim can be contradicted by data. A player who
    // simply hasn't filled the questionnaire (floor defaults to 1) is "uncalibrated",
    // not a smurf.
    smurfSuspected: result.smurfSuspected && hasQuestionnaire,
    generalSkill: est?.skill ?? null,
    generalSkillSe: est?.se ?? null,
    scopeGames,
    provisional: scopeGames < PROVISIONAL_MIN_GAMES,
    matchmakingWinChance: skillToWinChance(result.matchmakingSkill),
    // Headline tier name — the competition band (matchmakingBand), i.e. what the profile shows
    // and what gates tournament entry. "Unrated" when we have no real signal (not "New").
    bandName: rated ? BAND_NAMES[result.matchmakingBand]! : 'Unrated',
    hasQuestionnaire,
    rated,
    pendingCalibrationTypes: pendingCalibrationTypes(answers, questions),
  };
}

/** The timeless all-time hierarchical fit every classification reads (cached). */
export function getClassificationModel(prisma: PrismaClient, redis: Redis | undefined): Promise<RatingModel> {
  // General Skill is TIMELESS by design: it spans all versions. The per-version meta
  // lives in the model's MatchupEffect (keyed by versionId|battleType), NOT in which
  // games feed the GS fit — an all-time fit already scores each game against its own
  // version's favourability. Scoping the fit to the active version reset every player
  // to their questionnaire floor on each new version. Always fit all-time.
  return getRatingModel(prisma, redis, { versionId: null, config: { hierarchical: true } });
}

/**
 * Full skill classification for a player in one scope (default OVERALL): questionnaire floor +
 * hierarchical skill → matchmaking (Bayes blend) and gating (MAX) bands.
 */
export async function getPlayerClassification(
  prisma: PrismaClient,
  redis: Redis | undefined,
  _versionId: string | null, // deprecated: classification is timeless; kept for signature stability
  playerId: string,
  scope: SkillScope = 'OVERALL',
): Promise<PlayerClassification> {
  const [answers, questions, model] = await Promise.all([
    loadAnswers(prisma, playerId),
    loadCalibrationQuestions(prisma),
    getClassificationModel(prisma, redis),
  ]);
  return classifyWithModel(model, answers, questions, playerId, scope);
}

/**
 * Merge new questionnaire answers into the user's stored profile (incremental —
 * the wizard asks only unknown questions, answers accumulate). Unknown question
 * ids are dropped so the store stays clean.
 */
export async function saveCalibrationAnswers(
  prisma: PrismaClient,
  playerId: string,
  newAnswers: Record<string, string>,
): Promise<Record<string, string>> {
  const valid = new Set(CALIBRATION_QUESTIONS.map((q) => q.id));
  const existing = await loadAnswers(prisma, playerId);
  const merged = { ...existing };
  for (const [qid, value] of Object.entries(newAnswers)) {
    if (valid.has(qid)) merged[qid] = value;
  }
  await prisma.user.update({
    where: { id: playerId },
    data: { calibration_answers: merged },
  });
  return merged;
}
