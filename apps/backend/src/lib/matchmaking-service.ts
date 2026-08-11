/**
 * DB glue for the fair-matchmaking engine — the one impure layer around lib/matchmaking.ts.
 * Resolves the rating model, the measured matchup matrix and the Model-Strength map into the
 * plain `MatchmakingData` the pure scorer consumes, and turns that into the per-pair surcharge
 * the Swiss optimiser uses for Faction War. See plans/matchmaking-engine-design.md.
 */

import type { PrismaClient } from '@rizzotto/db';
import type { Redis } from 'ioredis';
import { getRatingModel } from './rating-model-service.js';
import { factionStrengths } from './breakdown-service.js';
import { getMatchupMatrix } from './heatmap.js';
import { makeFactionTilt, unfairness, type MatchmakingData } from './matchmaking.js';
import type { FairnessCost } from './swiss.js';

/**
 * Resolve everything the fairness scorer needs for one season, once. Composes the cached rating
 * model (per-player-faction skill), the live faction-vs-faction matchup matrix, and the
 * Model-Strength map (the never-played fallback). All three are cached, so this is cheap.
 */
export async function loadMatchmakingData(
  prisma: PrismaClient,
  redis: Redis | undefined,
  seasonId: string,
): Promise<MatchmakingData> {
  const [model, cells, strengths] = await Promise.all([
    getRatingModel(prisma, redis, { seasonId }),
    getMatchupMatrix(prisma, seasonId),
    factionStrengths(prisma, redis, seasonId),
  ]);
  const strengthByFaction = new Map(strengths.map((s) => [s.factionId, s.meanNeutralWinChance]));
  const factionTilt = makeFactionTilt(cells, strengthByFaction);
  return {
    skillOf: (playerId, factionId) => model.getPlayerFactionSkill(playerId, factionId),
    factionTilt,
  };
}

/**
 * Scale for the Faction-War pairing surcharge. `unfairness` is in [0, 0.5]; ×100 → [0, 50],
 * which stays strictly below the 100-cost of a single 0.5-point Swiss score step (swiss.ts
 * SCALE_SCORE). So the score gap always outranks fairness — the surcharge only breaks ties
 * within a score group toward the coin-flip matchup. In round 1 every score gap is 0, so it
 * drives the whole pairing.
 */
const FAIRNESS_SCALE = 100;

/**
 * Build the Faction-War fairness surcharge for `generateSwissRound`. Players without a locked
 * faction contribute nothing (the surcharge is 0), so a mixed field degrades gracefully.
 */
export function factionWarPairingCost(data: MatchmakingData): FairnessCost {
  return (a, b) => {
    if (!a.factionId || !b.factionId) return 0;
    return Math.round(unfairness(data, a.userId, a.factionId, b.userId, b.factionId) * FAIRNESS_SCALE);
  };
}

/**
 * Resolve the Swiss pairing surcharge for a tournament: the Faction-War fairness cost when the
 * tournament is Faction War (and rating data exists), otherwise `undefined`. Callers pass the
 * result straight to `generateSwissRound` — it's a no-op for every other mode, so the normal
 * Swiss pairing is untouched.
 */
export async function resolveFactionWarFairness(
  prisma: PrismaClient,
  redis: Redis | undefined,
  mode: string | null | undefined,
): Promise<FairnessCost | undefined> {
  if (mode !== 'FACTION_WAR') return undefined;
  const season = await prisma.season.findFirst({
    where: { is_active: true },
    select: { id: true },
  });
  if (!season) return undefined;
  const data = await loadMatchmakingData(prisma, redis, season.id);
  return factionWarPairingCost(data);
}
