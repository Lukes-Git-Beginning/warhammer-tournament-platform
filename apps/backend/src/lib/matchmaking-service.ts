/**
 * DB glue for the fair-matchmaking engine — the one impure layer around lib/matchmaking.ts.
 * Resolves the rating model, the measured matchup matrix and the Model-Strength map into the
 * plain `MatchmakingData` the pure scorer consumes, and turns that into the per-pair surcharge
 * the Swiss optimiser uses for Faction War. See plans/matchmaking-engine-design.md.
 */

import type { PrismaClient } from '@rizzotto/db';
import type { Redis } from 'ioredis';
import { getRatingModel } from './rating-model-service.js';
import { factionUnfairness, type MatchmakingData } from './matchmaking.js';
import type { FairnessCost } from './swiss.js';
import { seedFactionWarOrder, type SeedableFormat } from './faction-war-seeding.js';

/**
 * Resolve everything the fairness scorer needs for one season, once — all from the cached rating
 * model. `skillOf` is the per-(player, faction) skill; the faction tilt is the model's
 * skill-adjusted matchup effect (so logistic(tilt) is the site's "favourability" rating, not the
 * opponent-contaminated raw win-rate). `hasData` reports whether the pair has any games, for the
 * challenge finder's never-played skip.
 */
export async function loadMatchmakingData(
  prisma: PrismaClient,
  redis: Redis | undefined,
  seasonId: string,
): Promise<MatchmakingData> {
  const model = await getRatingModel(prisma, redis, { seasonId });
  // Canonical (X<Y) pairs that actually have decisive games.
  const sampled = new Set<string>();
  for (const e of model.matchupEffects) {
    if (e.sampleSize > 0) sampled.add(`${e.factionXId}:${e.factionYId}`);
  }
  return {
    skillOf: (playerId, factionId) => model.getPlayerFactionSkill(playerId, factionId),
    factionTilt: (factionX, factionY) => {
      if (factionX === factionY) return { tilt: 0, hasData: false }; // mirror — a true coin-flip
      const [a, b] = factionX < factionY ? [factionX, factionY] : [factionY, factionX];
      return { tilt: model.getMatchupEffect(factionX, factionY), hasData: sampled.has(`${a}:${b}`) };
    },
  };
}

/**
 * Scale for the Faction-War pairing surcharge. `factionUnfairness` is in [0, 0.5]; ×100 → [0, 50],
 * which stays strictly below the 100-cost of a single 0.5-point Swiss score step (swiss.ts
 * SCALE_SCORE). So the score gap always outranks fairness — the surcharge only breaks ties
 * within a score group toward the coin-flip matchup. In round 1 every score gap is 0, so it
 * drives the whole pairing.
 */
const FAIRNESS_SCALE = 100;

/**
 * Build the Faction-War fairness surcharge for `generateSwissRound`. Faction level only — the
 * players' skill is ignored, so the round optimum depends solely on the faction win-rates
 * (fixed until the rates move), not on who holds which faction. Players without a locked faction
 * contribute nothing (surcharge 0), so a mixed field degrades gracefully.
 */
export function factionWarPairingCost(data: MatchmakingData): FairnessCost {
  return (a, b) => {
    if (!a.factionId || !b.factionId) return 0;
    const { hasData } = data.factionTilt(a.factionId, b.factionId);
    // Never-played pair: the model has no favourability signal (it would read a false 50%
    // coin-flip). Treat it as maximally uncertain so the optimiser prefers known matchups —
    // still bounded below one score step, so the Swiss score gap stays primary.
    if (!hasData) return Math.round(0.5 * FAIRNESS_SCALE);
    return Math.round(factionUnfairness(data, a.factionId, b.factionId) * FAIRNESS_SCALE);
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

/**
 * Reorder participants into a fair Faction War seed order for an elimination bracket, so each
 * player's first game is as balanced a faction matchup as the data allows. Returns
 * `participantIds` unchanged for any non-Faction-War mode, or when no active season / rating data
 * exists — so the caller can always pass the result straight to the bracket generator. See
 * plans/faction-war-bracket-seeding.md.
 */
export async function resolveFactionWarSeedOrder(
  prisma: PrismaClient,
  redis: Redis | undefined,
  tournamentId: string,
  mode: string | null | undefined,
  participantIds: string[],
  factionById: Map<string, string | null>,
  format: SeedableFormat,
): Promise<string[]> {
  if (mode !== 'FACTION_WAR') return participantIds;
  const season = await prisma.season.findFirst({
    where: { is_active: true },
    select: { id: true },
  });
  if (!season) return participantIds;
  const data = await loadMatchmakingData(prisma, redis, season.id);
  return seedFactionWarOrder(tournamentId, participantIds, factionById, data, format);
}
