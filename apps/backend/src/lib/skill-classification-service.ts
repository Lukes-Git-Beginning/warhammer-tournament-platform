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
import {
  classify,
  questionnaireFloor,
  skillToWinChance,
  BAND_NAMES,
  CALIBRATION_QUESTIONS,
  type Classification,
  type CalibrationQuestion,
} from './skill-classification.js';

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
  return parsed.success ? parsed.data : [...CALIBRATION_QUESTIONS];
}

export interface PlayerClassification extends Classification {
  /** Raw general skill (log-odds) and its SE; null when the player has no games. */
  generalSkill: number | null;
  generalSkillSe: number | null;
  /** Win-chance (0..1) of the blended matchmaking skill vs the average player. */
  matchmakingWinChance: number;
  /** Name of the gating band (the player's headline tier). */
  bandName: string;
  /** Whether the player has answered any scoring questions yet. */
  hasQuestionnaire: boolean;
  /** True when there is real signal (questionnaire or fitted data); false = "Unrated". */
  rated: boolean;
}

/** Read a user's stored calibration answers (question id → option value). */
async function loadAnswers(
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
 * Full skill classification for a player in a season: questionnaire floor +
 * hierarchical general skill → matchmaking (Bayes blend) and gating (MAX) bands.
 */
export async function getPlayerClassification(
  prisma: PrismaClient,
  redis: Redis | undefined,
  seasonId: string,
  playerId: string,
): Promise<PlayerClassification> {
  const answers = await loadAnswers(prisma, playerId);
  const questions = await loadCalibrationQuestions(prisma);
  const qFloor = questionnaireFloor(answers, questions);

  // Always use the hierarchical model for the general skill (see file header).
  const model = await getRatingModel(prisma, redis, {
    seasonId,
    config: { hierarchical: true },
  });
  const gs = model.getGeneralSkill(playerId);

  const result = classify(qFloor, {
    generalSkill: gs?.skill ?? null,
    stdError: gs?.se ?? null,
  });

  const hasQuestionnaire = Object.keys(answers).length > 0;
  // #18 — "rated" means we have real signal: a questionnaire OR fitted game data.
  // A player with neither is NOT band-1 "New"; the default floor is just a
  // placeholder. Such players are surfaced as "Unrated" and kept out of band stats.
  const rated = hasQuestionnaire || gs != null;

  return {
    ...result,
    // Only a real (self-reported) claim can be contradicted by data. A player who
    // simply hasn't filled the questionnaire (floor defaults to 1) is "uncalibrated",
    // not a smurf.
    smurfSuspected: result.smurfSuspected && hasQuestionnaire,
    generalSkill: gs?.skill ?? null,
    generalSkillSe: gs?.se ?? null,
    matchmakingWinChance: skillToWinChance(result.matchmakingSkill),
    // Headline tier name — the competition band (matchmakingBand), i.e. what the profile shows
    // and what now gates tournament entry. "Unrated" when we have no real signal (not "New").
    bandName: rated ? BAND_NAMES[result.matchmakingBand]! : 'Unrated',
    hasQuestionnaire,
    rated,
  };
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
