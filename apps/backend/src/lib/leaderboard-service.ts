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

export interface DynamicLeaderboardEntry {
  playerId: string;
  displayName: string;
  avatarUrl: string | null;
  totalFinalPoints: number;
  totalRawPoints: number;
  totalMatches: number;
  wins: number;
  losses: number;
}

interface ConfirmedMatch {
  player1_id: string;
  player2_id: string;
  winner_id: string;
  player1_faction_id: string;
  player2_faction_id: string;
}

interface PlayerAgg {
  matches: number;
  wins: number;
  losses: number;
  totalRawPoints: number;
  totalFinalPoints: number;
}

/** Load the confirmed-match rows of a season (non-null fields guaranteed by the where-clause). */
export async function loadConfirmedMatches(
  prisma: PrismaClient,
  seasonId: string,
): Promise<ConfirmedMatch[]> {
  const rows = await prisma.match.findMany({
    where: confirmedMatchWhere(seasonId),
    select: {
      player1_id: true,
      player2_id: true,
      winner_id: true,
      player1_faction_id: true,
      player2_faction_id: true,
    },
  });
  return rows as ConfirmedMatch[];
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
  const matches = await loadConfirmedMatches(prisma, seasonId);
  const model = await getRatingModel(prisma, redis, { seasonId });

  // --- Pass 1: per-player totals + per-(player, opponent) match counts -------
  const agg = new Map<string, PlayerAgg>();
  const opponentCounts = new Map<string, Map<string, number>>();

  const ensureAgg = (id: string): PlayerAgg => {
    let a = agg.get(id);
    if (!a) {
      a = { matches: 0, wins: 0, losses: 0, totalRawPoints: 0, totalFinalPoints: 0 };
      agg.set(id, a);
    }
    return a;
  };
  const bumpOpponent = (player: string, opponent: string): void => {
    let inner = opponentCounts.get(player);
    if (!inner) {
      inner = new Map();
      opponentCounts.set(player, inner);
    }
    inner.set(opponent, (inner.get(opponent) ?? 0) + 1);
  };

  for (const m of matches) {
    const loserId = m.winner_id === m.player1_id ? m.player2_id : m.player1_id;
    ensureAgg(m.winner_id).wins += 1;
    ensureAgg(loserId).losses += 1;
    ensureAgg(m.winner_id).matches += 1;
    ensureAgg(loserId).matches += 1;
    bumpOpponent(m.player1_id, m.player2_id);
    bumpOpponent(m.player2_id, m.player1_id);
  }

  // --- Pass 2: points for each win, using current model + current shares -----
  for (const m of matches) {
    const winnerIsP1 = m.winner_id === m.player1_id;
    const winnerId = m.winner_id;
    const loserId = winnerIsP1 ? m.player2_id : m.player1_id;
    const winnerFaction = winnerIsP1 ? m.player1_faction_id : m.player2_faction_id;
    const loserFaction = winnerIsP1 ? m.player2_faction_id : m.player1_faction_id;

    const p = model.expectedChanceToWin(winnerId, winnerFaction, loserId, loserFaction);
    const raw = rawPoints(p);

    const winnerTotal = agg.get(winnerId)!.matches;
    const vsOpponent = opponentCounts.get(winnerId)?.get(loserId) ?? 0;
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
    select: { id: true, username: true, avatar_url: true },
  });
  const userMap = new Map(users.map((u) => [u.id, u]));

  const entries: DynamicLeaderboardEntry[] = playerIds.map((id) => {
    const a = agg.get(id)!;
    const u = userMap.get(id);
    return {
      playerId: id,
      displayName: u?.username ?? 'Unknown',
      avatarUrl: u?.avatar_url ?? null,
      totalFinalPoints: a.totalFinalPoints,
      totalRawPoints: a.totalRawPoints,
      totalMatches: a.matches,
      wins: a.wins,
      losses: a.losses,
    };
  });

  entries.sort((x, y) => y.totalFinalPoints - x.totalFinalPoints || y.wins - x.wins);
  return entries;
}
