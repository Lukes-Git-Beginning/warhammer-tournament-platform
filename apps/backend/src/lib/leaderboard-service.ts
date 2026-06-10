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
  totalGames: number;
  wins: number;
  losses: number;
}

interface ConfirmedGame {
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
 * Load confirmed games of a season. Mirrors All-Games logic: load via Match,
 * expand to MatchGame records where they exist, synthesise a single game for
 * matches that have no game records (pre-GL-fix data).
 */
export async function loadConfirmedGames(
  prisma: PrismaClient,
  seasonId: string,
): Promise<ConfirmedGame[]> {
  const matches = await prisma.match.findMany({
    where: confirmedMatchWhere(seasonId),
    select: {
      player1_id: true,
      player2_id: true,
      winner_id: true,
      player1_faction_id: true,
      player2_faction_id: true,
      tournament_id: true,
      games: {
        select: {
          winner_id: true,
          player1_faction_id: true,
          player2_faction_id: true,
        },
      },
    },
  });

  const tournamentIds = [...new Set(matches.map((m) => m.tournament_id).filter((id): id is string => id !== null))];
  const participants = tournamentIds.length
    ? await prisma.tournamentParticipant.findMany({
        where: { tournament_id: { in: tournamentIds }, deleted_at: null },
        select: { tournament_id: true, user_id: true, faction_id: true },
      })
    : [];
  const pfMap = new Map(
    participants.map((p) => [`${p.tournament_id}:${p.user_id}`, p.faction_id]),
  );
  const pf = (tid: string, uid: string) => pfMap.get(`${tid}:${uid}`) ?? null;

  return matches.flatMap((m): ConfirmedGame[] => {
    const p1 = m.player1_id!;
    const p2 = m.player2_id!;
    const matchFX = m.player1_faction_id ?? (m.tournament_id ? pf(m.tournament_id, p1) : null);
    const matchFY = m.player2_faction_id ?? (m.tournament_id ? pf(m.tournament_id, p2) : null);

    const decisiveGames = m.games.filter((g) => g.winner_id !== null);

    if (decisiveGames.length > 0) {
      return decisiveGames.map((g) => ({
        player1_id: p1,
        player2_id: p2,
        winner_id: g.winner_id!,
        player1_faction_id: g.player1_faction_id ?? matchFX,
        player2_faction_id: g.player2_faction_id ?? matchFY,
      }));
    }

    // No game records — treat the match as a single synthetic game
    if (!m.winner_id) return [];
    return [{
      player1_id: p1,
      player2_id: p2,
      winner_id: m.winner_id,
      player1_faction_id: matchFX,
      player2_faction_id: matchFY,
    }];
  });
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

  // --- Pass 1: per-player totals + per-(player, opponent) game counts --------
  const agg = new Map<string, PlayerAgg>();
  const opponentCounts = new Map<string, Map<string, number>>();

  const ensureAgg = (id: string): PlayerAgg => {
    let a = agg.get(id);
    if (!a) {
      a = { games: 0, wins: 0, losses: 0, totalRawPoints: 0, totalFinalPoints: 0 };
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

  for (const g of games) {
    const loserId = g.winner_id === g.player1_id ? g.player2_id : g.player1_id;
    ensureAgg(g.winner_id).wins += 1;
    ensureAgg(loserId).losses += 1;
    ensureAgg(g.winner_id).games += 1;
    ensureAgg(loserId).games += 1;
    bumpOpponent(g.player1_id, g.player2_id);
    bumpOpponent(g.player2_id, g.player1_id);
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

    const winnerTotal = agg.get(winnerId)!.games;
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
      totalGames: a.games,
      wins: a.wins,
      losses: a.losses,
    };
  });

  entries.sort((x, y) => y.totalFinalPoints - x.totalFinalPoints || y.wins - x.wins);
  return entries;
}
