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

import type { PrismaClient } from '@rizzotto/db';
import type { Redis } from 'ioredis';
import { getRatingModel } from './rating-model-service.js';
import { logistic } from './rating-model.js';
import { rawPoints, opponentShare, opponentModifier, finalPoints } from './scoring-service.js';
import { loadConfirmedGames, type ConfirmedGame } from './leaderboard-service.js';

// ---------------------------------------------------------------------------
// Shared WIN-count helpers — derived from the SAME game source the leaderboard
// uses (loadConfirmedGames), so the explainability numbers match the ranking
// exactly: game-level, incl. the synthetic-game fallback for pre-GL-fix data.
// ---------------------------------------------------------------------------

/** How many confirmed games the player WON in the season. */
function playerTotalWins(games: ConfirmedGame[], playerId: string): number {
  return games.filter((g) => g.winner_id === playerId).length;
}

/** How many confirmed games the player WON against this specific opponent. */
function winsBetween(games: ConfirmedGame[], playerId: string, opponentId: string): number {
  return games.filter(
    (g) =>
      g.winner_id === playerId &&
      ((g.player1_id === playerId && g.player2_id === opponentId) ||
        (g.player1_id === opponentId && g.player2_id === playerId)),
  ).length;
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

  // Game-level win counts from the same source as the leaderboard → identical share.
  const games = await loadConfirmedGames(prisma, match.season_id);
  const total = playerTotalWins(games, winnerId);
  const vs = winsBetween(games, winnerId, loserId);
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
  winsVsOpponent: number;
  playerTotalWins: number;
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
  // Single game source — identical to the leaderboard, incl. synthetic-game fallback.
  const games = await loadConfirmedGames(prisma, seasonId);
  const total = playerTotalWins(games, playerId);
  const vs = winsBetween(games, playerId, opponentId);
  const share = opponentShare(vs, total);
  const mod = opponentModifier(share, total);

  const model = await getRatingModel(prisma, redis, { seasonId });

  // Raw points the player earned from each won game against this opponent.
  let rawSum = 0;
  for (const g of games) {
    if (g.winner_id !== playerId) continue;
    const playerIsP1 = g.player1_id === playerId;
    const isVsOpponent = playerIsP1 ? g.player2_id === opponentId : g.player1_id === opponentId;
    if (!isVsOpponent) continue;
    const playerFaction = playerIsP1 ? g.player1_faction_id : g.player2_faction_id;
    const oppFaction = playerIsP1 ? g.player2_faction_id : g.player1_faction_id;
    const pWin =
      playerFaction && oppFaction
        ? model.expectedChanceToWin(playerId, playerFaction, opponentId, oppFaction)
        : 0.5; // no faction data — neutral weighting (matches leaderboard)
    rawSum += rawPoints(pWin);
  }

  return {
    playerId,
    opponentId,
    winsVsOpponent: vs,
    playerTotalWins: total,
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

// A single "general strength" per faction: the mean win-chance (vs a neutral opponent) of the
// players who use it, from the model's per-(player, faction) skill — i.e. "how well does a
// representative player do with this faction, controlling for who they played". Distinct from
// the raw win-rate (which is contaminated by opponent skill) and from the matchup matrix (which
// is faction-vs-faction). Reuses the cached model, so it is cheap alongside the matrix.
export interface FactionStrengthEntry {
  factionId: string;
  meanNeutralWinChance: number; // mean logistic(PFS) over players with a fitted skill for this faction
  playerCount: number;
  lowSampleWarning: boolean;
}

export async function factionStrengths(
  prisma: PrismaClient,
  redis: Redis | undefined,
  seasonId: string,
): Promise<FactionStrengthEntry[]> {
  const model = await getRatingModel(prisma, redis, { seasonId });
  const byFaction = new Map<string, { sum: number; count: number }>();
  for (const e of model.playerFactionSkills) {
    const cur = byFaction.get(e.factionId) ?? { sum: 0, count: 0 };
    cur.sum += logistic(e.skill);
    cur.count += 1;
    byFaction.set(e.factionId, cur);
  }
  return [...byFaction.entries()].map(([factionId, { sum, count }]) => ({
    factionId,
    meanNeutralWinChance: count > 0 ? sum / count : 0.5,
    playerCount: count,
    lowSampleWarning: count < 3,
  }));
}

// ---------------------------------------------------------------------------
// #5 — Player faction proficiency table
// ---------------------------------------------------------------------------

export interface PlayerFactionProficiencyEntry {
  playerId: string;
  factionId: string;
  playerFactionSkill: number; // raw model log-odds (can be negative or >1); used for sorting
  neutralWinChance: number; // logistic(skill): win chance vs a neutral/average opponent, in [0..1]
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

  // Game-level data: each individual battle (MatchGame) the player participated in.
  // BYEs are automatically excluded — they have no MatchGame records.
  const playerGames = await prisma.matchGame.findMany({
    where: {
      status: 'COMPLETED',
      winner_id: { not: null },
      counts_for_leaderboard: true,
      match: {
        season_id: seasonId,
        deleted_at: null,
        OR: [{ player1_id: playerId }, { player2_id: playerId }],
      },
    },
    select: {
      winner_id: true,
      player1_faction_id: true,
      player2_faction_id: true,
      match: { select: { player1_id: true } },
    },
  });

  // Tally games/wins/losses per faction the player actually used.
  const tally = new Map<string, { games: number; wins: number; losses: number }>();
  for (const g of playerGames) {
    const playerIsP1 = g.match.player1_id === playerId;
    const faction = playerIsP1 ? g.player1_faction_id : g.player2_faction_id;
    if (!faction) continue;
    const won = g.winner_id === playerId;
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

  return [...tally.entries()].map(([factionId, t]) => {
    const skill = model.getPlayerFactionSkill(playerId, factionId);
    return {
      playerId,
      factionId,
      playerFactionSkill: skill,
      neutralWinChance: logistic(skill),
      games: t.games,
      wins: t.wins,
      losses: t.losses,
      lowSampleWarning: warnOf.get(factionId) ?? t.games < 5,
    };
  });
}
