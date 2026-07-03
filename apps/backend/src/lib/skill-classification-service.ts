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
import { getRatingModel } from './rating-model-service.js';
import {
  classify,
  questionnaireFloor,
  skillToWinChance,
  BAND_NAMES,
  CALIBRATION_QUESTIONS,
  type Classification,
} from './skill-classification.js';

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
  const qFloor = questionnaireFloor(answers);

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

  return {
    ...result,
    // Only a real (self-reported) claim can be contradicted by data. A player who
    // simply hasn't filled the questionnaire (floor defaults to 1) is "uncalibrated",
    // not a smurf.
    smurfSuspected: result.smurfSuspected && hasQuestionnaire,
    generalSkill: gs?.skill ?? null,
    generalSkillSe: gs?.se ?? null,
    matchmakingWinChance: skillToWinChance(result.matchmakingSkill),
    bandName: BAND_NAMES[result.gatingBand]!,
    hasQuestionnaire,
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
