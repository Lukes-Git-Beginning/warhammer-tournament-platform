// ---------------------------------------------------------------------------
// Breakdown Service — explainability for the dynamic leaderboard.
//
// Every leaderboard point must be reconstructable from current model values,
// the current opponent-share modifier, and stored confirmed match facts. These
// helpers expose exactly that derivation for:
//   - a single match            (matchBreakdown)
//   - a player/opponent pair     (playerOpponentBreakdown)
//   - the faction matchup matrix (factionMatchupMatrix)
//   - a player's faction table   (playerFactionProficiency)
// ---------------------------------------------------------------------------

import type { PrismaClient, Prisma } from '@rizzotto/db';
import type { Redis } from 'ioredis';
import { confirmedMatchWhere, getRatingModel } from './rating-model-service.js';
import { logistic } from './rating-model.js';
import { rawPoints, opponentShare, opponentModifier, finalPoints } from './scoring-service.js';

// ---------------------------------------------------------------------------
// Shared count helpers (single source of "what counts" via confirmedMatchWhere)
// ---------------------------------------------------------------------------

/** Count of a player's confirmed matches in the season. */
async function playerTotalMatches(
  prisma: PrismaClient,
  seasonId: string,
  playerId: string,
): Promise<number> {
  return prisma.match.count({
    where: {
      ...confirmedMatchWhere(seasonId),
      OR: [{ player1_id: playerId }, { player2_id: playerId }],
    } as Prisma.MatchWhereInput,
  });
}

/** Count of confirmed matches between two players in the season. */
async function matchesBetween(
  prisma: PrismaClient,
  seasonId: string,
  playerId: string,
  opponentId: string,
): Promise<number> {
  return prisma.match.count({
    where: {
      ...confirmedMatchWhere(seasonId),
      OR: [
        { player1_id: playerId, player2_id: opponentId },
        { player1_id: opponentId, player2_id: playerId },
      ],
    } as Prisma.MatchWhereInput,
  });
}

// ---------------------------------------------------------------------------
// #2 — Match scoring breakdown
// ---------------------------------------------------------------------------

export interface MatchScoringBreakdown {
  matchId: string;
  winner: { id: string; username: string };
  loser: { id: string; username: string };
  winnerFaction: string;
  loserFaction: string;
  winnerPlayerFactionSkill: number;
  loserPlayerFactionSkill: number;
  matchupEffect: number;
  expectedChanceToWin: number;
  rawPoints: number;
  opponentShare: number;
  opponentModifier: number;
  finalPoints: number;
}

export async function matchBreakdown(
  prisma: PrismaClient,
  redis: Redis | undefined,
  matchId: string,
): Promise<MatchScoringBreakdown | null> {
  const match = await prisma.match.findFirst({
    where: { id: matchId, deleted_at: null },
    select: {
      id: true,
      season_id: true,
      player1_id: true,
      player2_id: true,
      winner_id: true,
      player1_faction_id: true,
      player2_faction_id: true,
    },
  });

  // Only confirmed, decisive, fully-tagged matches are scoreable.
  if (
    !match ||
    !match.season_id ||
    !match.winner_id ||
    !match.player1_id ||
    !match.player2_id ||
    !match.player1_faction_id ||
    !match.player2_faction_id
  ) {
    return null;
  }

  const winnerIsP1 = match.winner_id === match.player1_id;
  const winnerId = match.winner_id;
  const loserId = winnerIsP1 ? match.player2_id : match.player1_id;
  const winnerFaction = winnerIsP1 ? match.player1_faction_id : match.player2_faction_id;
  const loserFaction = winnerIsP1 ? match.player2_faction_id : match.player1_faction_id;

  const model = await getRatingModel(prisma, redis, { seasonId: match.season_id });

  const winnerPFS = model.getPlayerFactionSkill(winnerId, winnerFaction);
  const loserPFS = model.getPlayerFactionSkill(loserId, loserFaction);
  const effect = model.getMatchupEffect(winnerFaction, loserFaction);
  const p = model.expectedChanceToWin(winnerId, winnerFaction, loserId, loserFaction);
  const raw = rawPoints(p);

  const total = await playerTotalMatches(prisma, match.season_id, winnerId);
  const vs = await matchesBetween(prisma, match.season_id, winnerId, loserId);
  const share = opponentShare(vs, total);
  const mod = opponentModifier(share, total);

  const users = await prisma.user.findMany({
    where: { id: { in: [winnerId, loserId] } },
    select: { id: true, username: true },
  });
  const nameOf = (id: string): string => users.find((u) => u.id === id)?.username ?? 'Unknown';

  return {
    matchId: match.id,
    winner: { id: winnerId, username: nameOf(winnerId) },
    loser: { id: loserId, username: nameOf(loserId) },
    winnerFaction,
    loserFaction,
    winnerPlayerFactionSkill: winnerPFS,
    loserPlayerFactionSkill: loserPFS,
    matchupEffect: effect,
    expectedChanceToWin: p,
    rawPoints: raw,
    opponentShare: share,
    opponentModifier: mod,
    finalPoints: finalPoints(raw, mod),
  };
}

// ---------------------------------------------------------------------------
// #3 — Player/opponent anti-farming breakdown
// ---------------------------------------------------------------------------

export interface PlayerOpponentBreakdown {
  playerId: string;
  opponentId: string;
  matchesVsOpponent: number;
  playerTotalMatches: number;
  opponentShare: number;
  opponentModifier: number;
  rawPointsFromWinsVsOpponent: number;
  finalPointsFromWinsVsOpponent: number;
}

export async function playerOpponentBreakdown(
  prisma: PrismaClient,
  redis: Redis | undefined,
  seasonId: string,
  playerId: string,
  opponentId: string,
): Promise<PlayerOpponentBreakdown> {
  const total = await playerTotalMatches(prisma, seasonId, playerId);
  const vs = await matchesBetween(prisma, seasonId, playerId, opponentId);
  const share = opponentShare(vs, total);
  const mod = opponentModifier(share, total);

  // Wins of `player` over `opponent` → raw points from the current model.
  const wins = await prisma.match.findMany({
    where: {
      ...confirmedMatchWhere(seasonId),
      winner_id: playerId,
      OR: [
        { player1_id: playerId, player2_id: opponentId },
        { player1_id: opponentId, player2_id: playerId },
      ],
    } as Prisma.MatchWhereInput,
    select: {
      player1_id: true,
      player2_id: true,
      player1_faction_id: true,
      player2_faction_id: true,
    },
  });

  const model = await getRatingModel(prisma, redis, { seasonId });

  let rawSum = 0;
  for (const w of wins) {
    const playerIsP1 = w.player1_id === playerId;
    const playerFaction = (playerIsP1 ? w.player1_faction_id : w.player2_faction_id)!;
    const oppFaction = (playerIsP1 ? w.player2_faction_id : w.player1_faction_id)!;
    rawSum += rawPoints(model.expectedChanceToWin(playerId, playerFaction, opponentId, oppFaction));
  }

  return {
    playerId,
    opponentId,
    matchesVsOpponent: vs,
    playerTotalMatches: total,
    opponentShare: share,
    opponentModifier: mod,
    rawPointsFromWinsVsOpponent: rawSum,
    finalPointsFromWinsVsOpponent: finalPoints(rawSum, mod),
  };
}

// ---------------------------------------------------------------------------
// #4 — Faction matchup matrix
// ---------------------------------------------------------------------------

export interface FactionMatchupMatrixEntry {
  factionA: string;
  factionB: string;
  matchupEffect: number;
  neutralEqualProficiencyWinChance: number; // logistic(effect): A's win chance at equal skill
  sampleSize: number;
  lowSampleWarning: boolean;
}

export async function factionMatchupMatrix(
  prisma: PrismaClient,
  redis: Redis | undefined,
  seasonId: string,
): Promise<FactionMatchupMatrixEntry[]> {
  const model = await getRatingModel(prisma, redis, { seasonId });
  return model.matchupEffects.map((e) => ({
    factionA: e.factionXId,
    factionB: e.factionYId,
    matchupEffect: e.effect,
    neutralEqualProficiencyWinChance: logistic(e.effect),
    sampleSize: e.sampleSize,
    lowSampleWarning: e.lowSampleWarning,
  }));
}

// ---------------------------------------------------------------------------
// #5 — Player faction proficiency table
// ---------------------------------------------------------------------------

export interface PlayerFactionProficiencyEntry {
  playerId: string;
  factionId: string;
  playerFactionSkill: number;
  games: number;
  wins: number;
  losses: number;
  lowSampleWarning: boolean;
}

export async function playerFactionProficiency(
  prisma: PrismaClient,
  redis: Redis | undefined,
  seasonId: string,
  playerId: string,
): Promise<PlayerFactionProficiencyEntry[]> {
  const model = await getRatingModel(prisma, redis, { seasonId });

  const matches = await prisma.match.findMany({
    where: {
      ...confirmedMatchWhere(seasonId),
      OR: [{ player1_id: playerId }, { player2_id: playerId }],
    } as Prisma.MatchWhereInput,
    select: {
      player1_id: true,
      winner_id: true,
      player1_faction_id: true,
      player2_faction_id: true,
    },
  });

  // Tally games/wins/losses per faction the player actually used.
  const tally = new Map<string, { games: number; wins: number; losses: number }>();
  for (const m of matches) {
    const playerIsP1 = m.player1_id === playerId;
    const faction = (playerIsP1 ? m.player1_faction_id : m.player2_faction_id)!;
    const won = m.winner_id === playerId;
    let t = tally.get(faction);
    if (!t) {
      t = { games: 0, wins: 0, losses: 0 };
      tally.set(faction, t);
    }
    t.games += 1;
    if (won) t.wins += 1;
    else t.losses += 1;
  }

  // Warning flags come from the fitted model entries (consistent threshold).
  const warnOf = new Map(
    model.playerFactionSkills
      .filter((e) => e.playerId === playerId)
      .map((e) => [e.factionId, e.lowSampleWarning]),
  );

  return [...tally.entries()].map(([factionId, t]) => ({
    playerId,
    factionId,
    playerFactionSkill: model.getPlayerFactionSkill(playerId, factionId),
    games: t.games,
    wins: t.wins,
    losses: t.losses,
    lowSampleWarning: warnOf.get(factionId) ?? t.games < 5,
  }));
}
