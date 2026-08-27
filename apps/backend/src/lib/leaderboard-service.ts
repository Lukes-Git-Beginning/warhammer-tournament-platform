// ---------------------------------------------------------------------------
// Leaderboard Service — aggregates dynamic FinalPoints per player.
//
// Everything is derived from confirmed match facts + the current rating model:
//   FinalPoints(win) = RawPoints(ExpectedChanceToWin) * OpponentModifier
//   LeaderboardScore(player) = Σ FinalPoints over all of the player's wins
//
// OpponentModifier is player-specific (asymmetric) and recomputed from the
// current dataset, so nothing is stored — a score is always rebuildable.
// ---------------------------------------------------------------------------

import type { PrismaClient } from '@rizzotto/db';
import type { Redis } from 'ioredis';
import { confirmedMatchWhere, getRatingModel } from './rating-model-service.js';
import { rawPoints, opponentShare, opponentModifier, finalPoints } from './scoring-service.js';
import { effectiveTiersOf, SUPPORTER_FLAG_SELECT, NO_TIERS } from './supporter-service.js';
import type { SupporterTiers } from './supporter-status.js';

export interface DynamicLeaderboardEntry {
  playerId: string;
  displayName: string;
  avatarUrl: string | null;
  tiers: SupporterTiers;
  totalFinalPoints: number;
  totalRawPoints: number;
  totalGames: number;
  wins: number;
  losses: number;
}

export interface ConfirmedGame {
  player1_id: string;
  player2_id: string;
  winner_id: string;
  player1_faction_id: string | null;
  player2_faction_id: string | null;
}

interface PlayerAgg {
  games: number;
  wins: number;
  losses: number;
  totalRawPoints: number;
  totalFinalPoints: number;
}

/**
 * Load the decisive confirmed games of a season. Games are the statistical unit:
 * read the MatchGame rows directly (a Bo3 contributes up to three games), keyed by
 * the leaderboard-eligible match filter. No synthetic fallback — every confirmed
 * match now carries its game rows (see the games-only backfill migration). Draws
 * (winner_id null) award no leaderboard points and are excluded.
 */
export async function loadConfirmedGames(
  prisma: PrismaClient,
  seasonId: string,
): Promise<ConfirmedGame[]> {
  const games = await prisma.matchGame.findMany({
    where: {
      status: 'COMPLETED',
      winner_id: { not: null },
      counts_for_leaderboard: true,
      match: confirmedMatchWhere(seasonId),
    },
    select: {
      winner_id: true,
      player1_faction_id: true,
      player2_faction_id: true,
      match: { select: { player1_id: true, player2_id: true } },
    },
  });

  return games.map((g): ConfirmedGame => ({
    player1_id: g.match.player1_id!,
    player2_id: g.match.player2_id!,
    winner_id: g.winner_id!,
    player1_faction_id: g.player1_faction_id,
    player2_faction_id: g.player2_faction_id,
  }));
}

/**
 * Compute the full season leaderboard (sorted by FinalPoints desc, wins as
 * tiebreak). The caller paginates + assigns ranks.
 */
export async function computeSeasonLeaderboard(
  prisma: PrismaClient,
  redis: Redis | undefined,
  seasonId: string,
): Promise<DynamicLeaderboardEntry[]> {
  const games = await loadConfirmedGames(prisma, seasonId);
  const model = await getRatingModel(prisma, redis, { seasonId });

  // --- Pass 1: per-player totals + per-(player, opponent) WIN counts ----------
  const agg = new Map<string, PlayerAgg>();
  const winsVsOpponent = new Map<string, Map<string, number>>();

  const ensureAgg = (id: string): PlayerAgg => {
    let a = agg.get(id);
    if (!a) {
      a = { games: 0, wins: 0, losses: 0, totalRawPoints: 0, totalFinalPoints: 0 };
      agg.set(id, a);
    }
    return a;
  };
  // Anti-farm share is "what fraction of MY wins came from one opponent", so the
  // count is directional — only the winner bumps the count against the loser.
  const bumpWin = (winner: string, opponent: string): void => {
    let inner = winsVsOpponent.get(winner);
    if (!inner) {
      inner = new Map();
      winsVsOpponent.set(winner, inner);
    }
    inner.set(opponent, (inner.get(opponent) ?? 0) + 1);
  };

  for (const g of games) {
    const loserId = g.winner_id === g.player1_id ? g.player2_id : g.player1_id;
    ensureAgg(g.winner_id).wins += 1;
    ensureAgg(loserId).losses += 1;
    ensureAgg(g.winner_id).games += 1;
    ensureAgg(loserId).games += 1;
    bumpWin(g.winner_id, loserId);
  }

  // --- Pass 2: points for each win, using current model + current shares -----
  for (const g of games) {
    const winnerIsP1 = g.winner_id === g.player1_id;
    const winnerId = g.winner_id;
    const loserId = winnerIsP1 ? g.player2_id : g.player1_id;
    const winnerFaction = winnerIsP1 ? g.player1_faction_id : g.player2_faction_id;
    const loserFaction = winnerIsP1 ? g.player2_faction_id : g.player1_faction_id;

    const p =
      winnerFaction && loserFaction
        ? model.expectedChanceToWin(winnerId, winnerFaction, loserId, loserFaction)
        : 0.5; // no faction data — neutral weighting
    const raw = rawPoints(p);

    const winnerTotal = agg.get(winnerId)!.wins;
    const vsOpponent = winsVsOpponent.get(winnerId)?.get(loserId) ?? 0;
    const share = opponentShare(vsOpponent, winnerTotal);
    const mod = opponentModifier(share, winnerTotal);

    const a = agg.get(winnerId)!;
    a.totalRawPoints += raw;
    a.totalFinalPoints += finalPoints(raw, mod);
  }

  // --- Display names ---------------------------------------------------------
  const playerIds = [...agg.keys()];
  const users = await prisma.user.findMany({
    where: { id: { in: playerIds } },
    select: { id: true, username: true, avatar_url: true, ...SUPPORTER_FLAG_SELECT },
  });
  const userMap = new Map(users.map((u) => [u.id, u]));

  const entries: DynamicLeaderboardEntry[] = playerIds.map((id) => {
    const a = agg.get(id)!;
    const u = userMap.get(id);
    return {
      playerId: id,
      displayName: u?.username ?? 'Unknown',
      avatarUrl: u?.avatar_url ?? null,
      tiers: u ? effectiveTiersOf(u) : NO_TIERS,
      totalFinalPoints: a.totalFinalPoints,
      totalRawPoints: a.totalRawPoints,
      totalGames: a.games,
      wins: a.wins,
      losses: a.losses,
    };
  });

  entries.sort((x, y) => y.totalFinalPoints - x.totalFinalPoints || y.wins - x.wins);
  return entries;
}

export interface PlayerStats {
  total_points: number;
  games_played: number;
  wins: number;
  losses: number;
}

const ZERO_STATS: PlayerStats = { total_points: 0, games_played: 0, wins: 0, losses: 0 };

/**
 * Single-player view of the dynamic season leaderboard. Reuses
 * computeSeasonLeaderboard (cache-hit likely via the rating model) and picks the
 * player's entry. Returns zero-valued stats — never undefined — when the player
 * has no confirmed games in the season.
 */
export async function getPlayerSeasonStats(
  prisma: PrismaClient,
  redis: Redis | undefined,
  seasonId: string,
  playerId: string,
): Promise<PlayerStats> {
  const board = await computeSeasonLeaderboard(prisma, redis, seasonId);
  const entry = board.find((e) => e.playerId === playerId);
  if (!entry) return { ...ZERO_STATS };
  return {
    total_points: entry.totalFinalPoints,
    games_played: entry.totalGames,
    wins: entry.wins,
    losses: entry.losses,
  };
}

/**
 * All-time dynamic stats: sum of getPlayerSeasonStats across every season the
 * player has at least one confirmed game in. Kept consistent with the leaderboard
 * so the profile never shows numbers that disagree with the ranking.
 */
export async function getPlayerAllTimeStats(
  prisma: PrismaClient,
  redis: Redis | undefined,
  playerId: string,
): Promise<PlayerStats> {
  const rows = await prisma.match.findMany({
    where: {
      status: 'COMPLETED',
      deleted_at: null,
      winner_id: { not: null },
      player1_id: { not: null },
      player2_id: { not: null },
      season_id: { not: null },
      counts_for_leaderboard: true,
      AND: [
        {
          OR: [
            { tournament: { counts_for_leaderboard: true } },
            { type: 'OPEN_PLAY', games: { some: { counts_for_leaderboard: true } } },
          ],
        },
        { OR: [{ player1_id: playerId }, { player2_id: playerId }] },
      ],
    },
    select: { season_id: true },
    distinct: ['season_id'],
  });

  const totals: PlayerStats = { ...ZERO_STATS };
  for (const { season_id } of rows) {
    if (!season_id) continue;
    const s = await getPlayerSeasonStats(prisma, redis, season_id, playerId);
    totals.total_points += s.total_points;
    totals.games_played += s.games_played;
    totals.wins += s.wins;
    totals.losses += s.losses;
  }
  return totals;
}
