// ---------------------------------------------------------------------------
// MMR Library — 3-Factor Win-Quality Points System
//
// Factors:
//   1. Faction-Matchup-Win-Rate (how favourable the matchup is globally)
//   2. Loser's Faction Mastery (how experienced the opponent is → harder win = more)
//   3. Winner's Faction Mastery dampener (high-mastery winner earns less on easy wins)
//
// No points for losses. Tournaments ignore the casual Anti-Farm cap.
// Faction mastery persists across seasons; matchup stats reset per season.
// ---------------------------------------------------------------------------

import type { PrismaClient } from '@rizzotto/db';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ComputeWinPointsArgs {
  winnerId: string;
  loserId: string;
  winnerFactionId: string;
  loserFactionId: string;
  isTournament: boolean; // false = casual / arena
  isMajor: boolean;      // tournament.is_major
  seasonId: string;
}

export interface WinPointsBreakdown {
  base: number;
  win_quality: number;
  matchup_factor: number;
  opponent_mastery_factor: number;
  my_mastery_dampener: number;
  anti_farm_modifier: number;
  major_bonus: number;
}

export interface ComputeWinPointsResult {
  points: number;
  breakdown: WinPointsBreakdown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(min: number, max: number, value: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Reads an AdminConfig key and returns it as a number. Falls back to
 * `defaultValue` if the key is missing or not a valid number.
 */
async function getAdminConfigInt(
  prisma: PrismaClient,
  key: string,
  defaultValue: number,
): Promise<number> {
  const row = await prisma.adminConfig.findUnique({ where: { key } });
  if (!row) return defaultValue;
  const v = row.value;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : defaultValue;
}

// ---------------------------------------------------------------------------
// Anti-Farm Cap helpers
// ---------------------------------------------------------------------------

/**
 * Returns ordered (player_a_id, player_b_id) and (faction_a_id, faction_b_id)
 * so the composite PK is stable regardless of who is winner/loser.
 */
function orderedPair(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a];
}

export async function incrementAntiFarmCap(
  prisma: PrismaClient,
  seasonId: string,
  player1: string,
  player2: string,
  faction1: string,
  faction2: string,
  points: number,
): Promise<void> {
  const [playerA, playerB] = orderedPair(player1, player2);
  const [factionA, factionB] = orderedPair(faction1, faction2);

  await prisma.antiFarmCap.upsert({
    where: {
      season_id_player_a_id_player_b_id_faction_a_id_faction_b_id: {
        season_id: seasonId,
        player_a_id: playerA,
        player_b_id: playerB,
        faction_a_id: factionA,
        faction_b_id: factionB,
      },
    },
    create: {
      season_id: seasonId,
      player_a_id: playerA,
      player_b_id: playerB,
      faction_a_id: factionA,
      faction_b_id: factionB,
      points_earned: points,
      max_cap: 200,
    },
    update: {
      points_earned: { increment: points },
    },
  });
}

// ---------------------------------------------------------------------------
// Faction Mastery Update
// ---------------------------------------------------------------------------

const MASTERY_DELTA = 10; // rating change per match
const MASTERY_FLOOR = 800; // minimum mastery rating

export async function updateFactionMasteryAfterMatch(
  prisma: PrismaClient,
  winnerId: string,
  winnerFactionId: string,
  loserId: string,
  loserFactionId: string,
): Promise<void> {
  const now = new Date();

  // Winner: games++, wins++, rating += DELTA (no cap)
  const winner = await prisma.factionMastery.findUnique({
    where: { user_id_faction_id: { user_id: winnerId, faction_id: winnerFactionId } },
    select: { rating: true },
  });
  const winnerNewRating = (winner?.rating ?? 1200) + MASTERY_DELTA;

  await prisma.factionMastery.upsert({
    where: { user_id_faction_id: { user_id: winnerId, faction_id: winnerFactionId } },
    create: {
      user_id: winnerId,
      faction_id: winnerFactionId,
      rating: 1200 + MASTERY_DELTA,
      games_played: 1,
      wins: 1,
      losses: 0,
      last_played_at: now,
    },
    update: {
      rating: winnerNewRating,
      games_played: { increment: 1 },
      wins: { increment: 1 },
      last_played_at: now,
    },
  });

  // Loser: games++, losses++, rating -= DELTA (floor at MASTERY_FLOOR)
  const loser = await prisma.factionMastery.findUnique({
    where: { user_id_faction_id: { user_id: loserId, faction_id: loserFactionId } },
    select: { rating: true },
  });
  const loserCurrentRating = loser?.rating ?? 1200;
  const loserNewRating = Math.max(MASTERY_FLOOR, loserCurrentRating - MASTERY_DELTA);

  await prisma.factionMastery.upsert({
    where: { user_id_faction_id: { user_id: loserId, faction_id: loserFactionId } },
    create: {
      user_id: loserId,
      faction_id: loserFactionId,
      rating: Math.max(MASTERY_FLOOR, 1200 - MASTERY_DELTA),
      games_played: 1,
      wins: 0,
      losses: 1,
      last_played_at: now,
    },
    update: {
      rating: loserNewRating,
      games_played: { increment: 1 },
      losses: { increment: 1 },
      last_played_at: now,
    },
  });
}

// ---------------------------------------------------------------------------
// FactionMatchupStat update after a match
// ---------------------------------------------------------------------------

/**
 * Increments win/loss counters for the winner→loser matchup direction
 * and recalculates win_rate.
 *
 * Convention: each (season, faction_a, faction_b) entry tracks wins FROM
 * faction_a's perspective over faction_b. So we upsert two rows:
 *   - (season, winnerFaction, loserFaction): wins++
 *   - (season, loserFaction, winnerFaction): losses++  (same as wins++ in the other direction)
 *
 * win_rate = wins / (wins + losses).
 */
export async function updateFactionMatchupStat(
  prisma: PrismaClient,
  seasonId: string,
  winnerFactionId: string,
  loserFactionId: string,
): Promise<void> {
  // Winner perspective: wins++
  {
    const existing = await prisma.factionMatchupStat.findUnique({
      where: {
        season_id_faction_a_id_faction_b_id: {
          season_id: seasonId,
          faction_a_id: winnerFactionId,
          faction_b_id: loserFactionId,
        },
      },
    });
    const newWins = (existing?.wins ?? 0) + 1;
    const newLosses = existing?.losses ?? 0;
    const total = newWins + newLosses;
    const winRate = total > 0 ? newWins / total : 0.5;

    await prisma.factionMatchupStat.upsert({
      where: {
        season_id_faction_a_id_faction_b_id: {
          season_id: seasonId,
          faction_a_id: winnerFactionId,
          faction_b_id: loserFactionId,
        },
      },
      create: {
        season_id: seasonId,
        faction_a_id: winnerFactionId,
        faction_b_id: loserFactionId,
        wins: 1,
        losses: 0,
        win_rate: winRate,
        source: 'OWN_DATA',
        confidence: 0.5,
      },
      update: {
        wins: { increment: 1 },
        win_rate: winRate,
        source: 'OWN_DATA',
      },
    });
  }

  // Loser perspective: losses++ (which is wins++ for the reverse direction)
  {
    const existing = await prisma.factionMatchupStat.findUnique({
      where: {
        season_id_faction_a_id_faction_b_id: {
          season_id: seasonId,
          faction_a_id: loserFactionId,
          faction_b_id: winnerFactionId,
        },
      },
    });
    const newWins = existing?.wins ?? 0;
    const newLosses = (existing?.losses ?? 0) + 1;
    const total = newWins + newLosses;
    const winRate = total > 0 ? newWins / total : 0.5;

    await prisma.factionMatchupStat.upsert({
      where: {
        season_id_faction_a_id_faction_b_id: {
          season_id: seasonId,
          faction_a_id: loserFactionId,
          faction_b_id: winnerFactionId,
        },
      },
      create: {
        season_id: seasonId,
        faction_a_id: loserFactionId,
        faction_b_id: winnerFactionId,
        wins: 0,
        losses: 1,
        win_rate: winRate,
        source: 'OWN_DATA',
        confidence: 0.5,
      },
      update: {
        losses: { increment: 1 },
        win_rate: winRate,
        source: 'OWN_DATA',
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Main: computeWinPoints
// ---------------------------------------------------------------------------

export async function computeWinPoints(
  prisma: PrismaClient,
  args: ComputeWinPointsArgs,
): Promise<ComputeWinPointsResult> {
  const {
    winnerId,
    loserId,
    winnerFactionId,
    loserFactionId,
    isTournament,
    isMajor,
    seasonId,
  } = args;

  // 1. Base points from AdminConfig
  const baseKey = isTournament ? 'mmr_base_points_tournament' : 'mmr_base_points_casual';
  const baseDefault = isTournament ? 100 : 50;
  const BASE = await getAdminConfigInt(prisma, baseKey, baseDefault);

  // 2. Major bonus multiplier
  const MAJOR_BONUS = isMajor ? 1.5 : 1.0;

  // 3. Faction matchup win-rate for winner (winner's faction vs loser's faction)
  const matchupStat = await prisma.factionMatchupStat.findUnique({
    where: {
      season_id_faction_a_id_faction_b_id: {
        season_id: seasonId,
        faction_a_id: winnerFactionId,
        faction_b_id: loserFactionId,
      },
    },
    select: { win_rate: true },
  });
  // win_rate is a Decimal → convert to number; default 0.5 if no data
  const matchupWinRate = matchupStat ? Number(matchupStat.win_rate) : 0.5;

  // 4. Mastery threshold
  const masteryThreshold = await getAdminConfigInt(
    prisma,
    'mmr_mastery_threshold_games',
    10,
  );

  // 5. Winner mastery
  const winnerMastery = await prisma.factionMastery.findUnique({
    where: { user_id_faction_id: { user_id: winnerId, faction_id: winnerFactionId } },
    select: { rating: true, games_played: true },
  });
  const winnerRating =
    winnerMastery && winnerMastery.games_played >= masteryThreshold
      ? winnerMastery.rating
      : 1200; // neutral default when below threshold

  // 6. Loser mastery
  const loserMastery = await prisma.factionMastery.findUnique({
    where: { user_id_faction_id: { user_id: loserId, faction_id: loserFactionId } },
    select: { rating: true, games_played: true },
  });
  const loserRating =
    loserMastery && loserMastery.games_played >= masteryThreshold
      ? loserMastery.rating
      : 1200; // neutral default when below threshold

  // 7. Three factors
  // matchup_factor: how "difficult" this matchup is for the winner
  const matchupFactor = 1 - matchupWinRate; // 0.0 (easy) → 1.0 (hard)

  // opponent_mastery_factor: harder to beat a higher-mastery opponent
  const opponentMasteryFactor = clamp(0.5, 1.5, loserRating / 1500);

  // my_mastery_dampener: high-mastery winner gets reduced reward on easy wins
  const myMasteryDampener = clamp(0.5, 1.0, 1.0 - (winnerRating - 1200) / 2000);

  // 8. Win quality composite
  const winQuality = matchupFactor * opponentMasteryFactor * myMasteryDampener;

  // 9. Anti-Farming modifier (casual only)
  let antiFarmModifier = 1.0;
  if (!isTournament) {
    const [playerA, playerB] = orderedPair(winnerId, loserId);
    const [factionA, factionB] = orderedPair(winnerFactionId, loserFactionId);

    const capRow = await prisma.antiFarmCap.findUnique({
      where: {
        season_id_player_a_id_player_b_id_faction_a_id_faction_b_id: {
          season_id: seasonId,
          player_a_id: playerA,
          player_b_id: playerB,
          faction_a_id: factionA,
          faction_b_id: factionB,
        },
      },
      select: { points_earned: true, max_cap: true },
    });

    if (capRow) {
      const remaining = capRow.max_cap - capRow.points_earned;
      antiFarmModifier = Math.max(0, remaining / capRow.max_cap);
    }
    // If no row exists yet: modifier = 1.0 (full points)
  }

  // 10. Final points (no negatives, rounded)
  const rawPoints = BASE * MAJOR_BONUS * winQuality * antiFarmModifier;
  const points = Math.max(0, Math.round(rawPoints));

  return {
    points,
    breakdown: {
      base: BASE,
      win_quality: winQuality,
      matchup_factor: matchupFactor,
      opponent_mastery_factor: opponentMasteryFactor,
      my_mastery_dampener: myMasteryDampener,
      anti_farm_modifier: antiFarmModifier,
      major_bonus: MAJOR_BONUS,
    },
  };
}
