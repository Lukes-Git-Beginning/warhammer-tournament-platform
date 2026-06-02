// ---------------------------------------------------------------------------
// Rating Model Service — async wrapper around the pure rating-model fit.
//
// Loads the confirmed-match dataset of a season from Prisma, fits the model
// (rating-model.ts), and caches the (JSON-safe) fit in Redis. The cached value
// is plain data; helpers are re-attached via createRatingModel() on read.
//
// The fit is expensive on a cold cache, so it is computed once per season and
// invalidated whenever a confirmed match changes. Match facts stay
// authoritative — the model is always rebuildable from them.
// ---------------------------------------------------------------------------

import type { PrismaClient, Prisma } from '@rizzotto/db';
import type { Redis } from 'ioredis';
import { cached, cacheKey, invalidate } from './cache.js';
import {
  fitRatingModel,
  createRatingModel,
  DEFAULT_RATING_MODEL_CONFIG,
  type MatchObservation,
  type RatingModel,
  type RatingModelData,
  type RatingModelConfig,
} from './rating-model.js';

const RATING_MODEL_TTL = 3600; // 1h fallback; primary refresh is event-driven invalidation

/**
 * Prisma `where` for the matches that feed the dynamic leaderboard: confirmed,
 * decisive (has a winner), both factions known, on a leaderboard-counting
 * tournament, tagged to this season. Single source of truth for "what counts".
 */
export function confirmedMatchWhere(seasonId: string): Prisma.MatchWhereInput {
  return {
    season_id: seasonId,
    status: 'COMPLETED',
    deleted_at: null,
    winner_id: { not: null },
    player1_id: { not: null },
    player2_id: { not: null },
    player1_faction_id: { not: null },
    player2_faction_id: { not: null },
    tournament: { counts_for_leaderboard: true },
  };
}

/** Load confirmed matches of a season as model observations (A = player1). */
export async function loadSeasonObservations(
  prisma: PrismaClient,
  seasonId: string,
): Promise<MatchObservation[]> {
  const matches = await prisma.match.findMany({
    where: confirmedMatchWhere(seasonId),
    select: {
      player1_id: true,
      player2_id: true,
      winner_id: true,
      player1_faction_id: true,
      player2_faction_id: true,
    },
  });

  return matches.map((m) => ({
    playerAId: m.player1_id!,
    playerBId: m.player2_id!,
    factionXId: m.player1_faction_id!,
    factionYId: m.player2_faction_id!,
    aWon: m.winner_id === m.player1_id,
  }));
}

/** Reads rating-model lambdas/thresholds from AdminConfig (falls back to defaults). */
export async function loadRatingModelConfig(
  prisma: PrismaClient,
): Promise<Partial<RatingModelConfig>> {
  const rows = await prisma.adminConfig.findMany({
    where: {
      key: {
        in: [
          'rating_model_lambda_pfs',
          'rating_model_lambda_me',
          'rating_model_low_sample',
          'rating_model_max_iter',
        ],
      },
    },
  });
  const num = (key: string): number | undefined => {
    const row = rows.find((r) => r.key === key);
    if (!row) return undefined;
    const n = typeof row.value === 'number' ? row.value : Number(row.value);
    return Number.isFinite(n) ? n : undefined;
  };

  const cfg: Partial<RatingModelConfig> = {};
  const lpfs = num('rating_model_lambda_pfs');
  const lme = num('rating_model_lambda_me');
  const low = num('rating_model_low_sample');
  const iter = num('rating_model_max_iter');
  if (lpfs !== undefined) cfg.lambdaPlayerFaction = lpfs;
  if (lme !== undefined) cfg.lambdaMatchup = lme;
  if (low !== undefined) cfg.lowSampleThreshold = low;
  if (iter !== undefined) cfg.maxIterations = iter;
  return cfg;
}

function toData(m: RatingModel): RatingModelData {
  return {
    playerFactionSkills: m.playerFactionSkills,
    matchupEffects: m.matchupEffects,
    fitIterations: m.fitIterations,
    finalLoss: m.finalLoss,
    totalMatches: m.totalMatches,
  };
}

export interface GetRatingModelArgs {
  seasonId: string;
  /** Explicit overrides; when omitted, config is read from AdminConfig. */
  config?: Partial<RatingModelConfig>;
}

/**
 * Returns the (cached) fitted rating model for a season, with helpers attached.
 * Cache key includes the effective config so a lambda change produces a fresh fit.
 */
export async function getRatingModel(
  prisma: PrismaClient,
  redis: Redis | undefined,
  args: GetRatingModelArgs,
): Promise<RatingModel> {
  const { seasonId } = args;
  const cfg: RatingModelConfig = {
    ...DEFAULT_RATING_MODEL_CONFIG,
    ...(await loadRatingModelConfig(prisma)),
    ...args.config,
  };

  const data = await cached<RatingModelData>(
    redis,
    cacheKey('rating-model', {
      seasonId,
      lpfs: cfg.lambdaPlayerFaction,
      lme: cfg.lambdaMatchup,
      iter: cfg.maxIterations,
      low: cfg.lowSampleThreshold,
    }),
    async () => {
      const observations = await loadSeasonObservations(prisma, seasonId);
      return toData(fitRatingModel(observations, cfg));
    },
    { ttlSeconds: RATING_MODEL_TTL },
  );

  return createRatingModel(data);
}

/** Invalidate the cached fit for a season (call after a confirmed match changes). */
export async function invalidateRatingModelCache(
  redis: Redis | undefined,
  seasonId: string,
): Promise<void> {
  await invalidate(redis, `rating-model:*seasonId=${seasonId}*`);
}
