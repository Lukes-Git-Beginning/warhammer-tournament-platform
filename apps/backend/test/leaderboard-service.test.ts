/**
 * Integration tests for the dynamic leaderboard pipeline against a real DB.
 *
 * Exercises load → fit → aggregate (computeSeasonLeaderboard) and the
 * explainability invariant: a player's leaderboard total equals the sum of the
 * per-match breakdowns. Also verifies anti-farm zeroing end-to-end.
 *
 * Requires a running Postgres (same as the other *.test.ts integration specs).
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { prisma } from '@rizzotto/db';
import { computeSeasonLeaderboard } from '../src/lib/leaderboard-service.js';
import { matchBreakdown, playerOpponentBreakdown } from '../src/lib/breakdown-service.js';
import {
  createTestUser,
  createTestSeason,
  createTestTournament,
  cleanupSeason,
  cleanupTournament,
  cleanupUsers,
} from './helpers/db-fixtures.js';

// Tracked for cleanup
const userIds: string[] = [];
const factionIds: string[] = [];
let tournamentId: string;
let seasonRR: string; // round-robin scenario
let seasonAF: string; // anti-farm scenario
let seasonTG: string; // wins-based targeting scenario

// Round-robin players
let A: string, B: string, C: string;
let f1: string, f2: string, f3: string;
const aWinMatchIds: string[] = [];

// Anti-farm players
let D: string, E: string;
const oppIds: string[] = [];

// Targeting players (wins-based anti-farm): favourite-victim vs bogey opponent
let P: string, V: string, Bg: string;
const tgOppIds: string[] = [];

let matchNo = 0;

async function createFaction(displayOrder: number): Promise<string> {
  const id = `test-faction-${randomUUID()}`;
  await prisma.faction.create({
    data: {
      id,
      name: `Test Faction ${displayOrder}`,
      race: 'test-race',
      category: 'ORDER',
      color_hex: '#abcdef',
      display_order: displayOrder,
    },
  });
  factionIds.push(id);
  return id;
}

async function newUser(): Promise<string> {
  const u = await createTestUser();
  userIds.push(u.id);
  return u.id;
}

async function completedMatch(
  seasonId: string,
  p1: string,
  p2: string,
  pf1: string,
  pf2: string,
  winner: string,
): Promise<string> {
  const m = await prisma.match.create({
    data: {
      tournament_id: tournamentId,
      round: 1,
      match_number: matchNo++,
      player1_id: p1,
      player2_id: p2,
      winner_id: winner,
      player1_faction_id: pf1,
      player2_faction_id: pf2,
      status: 'COMPLETED',
      result: winner === p1 ? 'PLAYER1_WIN' : 'PLAYER2_WIN',
      season_id: seasonId,
      played_at: new Date('2026-06-01'),
    },
  });
  return m.id;
}

beforeAll(async () => {
  const season1 = await createTestSeason({ is_active: true });
  const season2 = await createTestSeason({ is_active: false });
  seasonRR = season1.id;
  seasonAF = season2.id;

  const organizer = await newUser();
  const tournament = await createTestTournament({ organizerId: organizer });
  tournamentId = tournament.id;

  // Use display_order values far outside the 1..24 seed range to avoid collisions.
  f1 = await createFaction(901);
  f2 = await createFaction(902);
  f3 = await createFaction(903);

  // --- Round-robin scenario (all totals < 20 → modifier 1) ---
  A = await newUser();
  B = await newUser();
  C = await newUser();
  aWinMatchIds.push(await completedMatch(seasonRR, A, B, f1, f2, A)); // A beats B
  aWinMatchIds.push(await completedMatch(seasonRR, A, C, f1, f3, A)); // A beats C
  await completedMatch(seasonRR, B, C, f2, f3, B); // B beats C
  await completedMatch(seasonRR, C, A, f3, f1, C); // C beats A

  // --- Anti-farm scenario: D wins 20, 8 vs E (share 40% → 0), 12 vs distinct ---
  D = await newUser();
  E = await newUser();
  for (let i = 0; i < 8; i++) await completedMatch(seasonAF, D, E, f1, f2, D);
  for (let i = 0; i < 12; i++) {
    const o = await newUser();
    oppIds.push(o);
    await completedMatch(seasonAF, D, o, f1, f2, D);
  }

  // --- Targeting scenario (wins-based): P has 20 total WINS. ---
  // vs V (favourite victim): P wins 4 of 5 → 4/20 = 20% of wins → penalised (mod 0).
  // vs Bg (bogey): P wins 1 of 10, loses 9 → 1/20 = 5% of wins → NOT penalised,
  //   even though 10 of P's 30 GAMES (33%) were vs Bg. The old games-based share
  //   would have zeroed Bg; the wins-based share spares it. 15 further wins vs
  //   distinct opponents make up the remaining 75% of P's wins.
  const season3 = await createTestSeason({ is_active: false });
  seasonTG = season3.id;
  P = await newUser();
  V = await newUser();
  Bg = await newUser();
  for (let i = 0; i < 4; i++) await completedMatch(seasonTG, P, V, f1, f2, P); // P beats V ×4
  await completedMatch(seasonTG, P, V, f1, f2, V); // V beats P ×1
  await completedMatch(seasonTG, P, Bg, f1, f2, P); // P beats Bg ×1
  for (let i = 0; i < 9; i++) await completedMatch(seasonTG, P, Bg, f1, f2, Bg); // Bg beats P ×9
  for (let i = 0; i < 15; i++) {
    const o = await newUser();
    tgOppIds.push(o);
    await completedMatch(seasonTG, P, o, f1, f2, P); // P beats distinct ×15
  }
}, 30_000);

afterAll(async () => {
  await cleanupTournament(tournamentId); // deletes all matches first
  await prisma.faction.deleteMany({ where: { id: { in: factionIds } } });
  await cleanupSeason(seasonRR);
  await cleanupSeason(seasonAF);
  await cleanupSeason(seasonTG);
  await cleanupUsers(userIds);
  await prisma.$disconnect();
});

describe('computeSeasonLeaderboard — round robin', () => {
  it('reports correct wins/losses/matches per player', async () => {
    const board = await computeSeasonLeaderboard(prisma, undefined, seasonRR);
    const byId = new Map(board.map((e) => [e.playerId, e]));

    expect(byId.get(A)).toMatchObject({ wins: 2, losses: 1, totalGames: 3 });
    expect(byId.get(B)).toMatchObject({ wins: 1, losses: 1, totalGames: 2 });
    expect(byId.get(C)).toMatchObject({ wins: 1, losses: 2, totalGames: 3 });
  });

  it('all modifiers are 1 (totals < 20), so final == raw points', async () => {
    const board = await computeSeasonLeaderboard(prisma, undefined, seasonRR);
    for (const e of board) {
      expect(e.totalFinalPoints).toBeCloseTo(e.totalRawPoints, 6);
    }
  });

  it("a player's leaderboard total equals the sum of its match breakdowns (explainability)", async () => {
    const board = await computeSeasonLeaderboard(prisma, undefined, seasonRR);
    const aEntry = board.find((e) => e.playerId === A)!;

    let sum = 0;
    for (const mid of aWinMatchIds) {
      const bd = await matchBreakdown(prisma, undefined, mid);
      expect(bd).not.toBeNull();
      expect(bd!.winner.id).toBe(A);
      // Each point is reconstructable: final = 100*(1-p) * modifier
      expect(bd!.rawPoints).toBeCloseTo(100 * (1 - bd!.expectedChanceToWin), 6);
      expect(bd!.finalPoints).toBeCloseTo(bd!.rawPoints * bd!.opponentModifier, 6);
      sum += bd!.finalPoints;
    }
    expect(aEntry.totalFinalPoints).toBeCloseTo(sum, 6);
  });
});

describe('computeSeasonLeaderboard — anti-farm', () => {
  it('zeroes the over-played opponent while crediting the rest', async () => {
    const board = await computeSeasonLeaderboard(prisma, undefined, seasonAF);
    const dEntry = board.find((e) => e.playerId === D)!;

    expect(dEntry).toMatchObject({ wins: 20, losses: 0, totalGames: 20 });
    // 8 of 20 wins are zeroed → final strictly below raw.
    expect(dEntry.totalFinalPoints).toBeLessThan(dEntry.totalRawPoints);

    const vsE = await playerOpponentBreakdown(prisma, undefined, seasonAF, D, E);
    expect(vsE.winsVsOpponent).toBe(8);
    expect(vsE.playerTotalWins).toBe(20);
    expect(vsE.opponentShare).toBeCloseTo(0.4, 6);
    expect(vsE.opponentModifier).toBeCloseTo(0, 10);
    expect(vsE.rawPointsFromWinsVsOpponent).toBeGreaterThan(0);
    expect(vsE.finalPointsFromWinsVsOpponent).toBeCloseTo(0, 10);
  });
});

describe('computeSeasonLeaderboard — wins-based targeting', () => {
  it('penalises a favourite victim but spares a bogey opponent', async () => {
    // Favourite victim: 4 of P's 20 wins (20% share) → zeroed.
    const vsVictim = await playerOpponentBreakdown(prisma, undefined, seasonTG, P, V);
    expect(vsVictim.winsVsOpponent).toBe(4);
    expect(vsVictim.playerTotalWins).toBe(20);
    expect(vsVictim.opponentShare).toBeCloseTo(0.2, 6);
    expect(vsVictim.opponentModifier).toBeCloseTo(0, 10);

    // Bogey opponent: only 1 of P's 20 wins (5% share) → full credit, NOT penalised —
    // despite 10 of P's 30 games being vs Bg (the old games-based share would zero it).
    const vsBogey = await playerOpponentBreakdown(prisma, undefined, seasonTG, P, Bg);
    expect(vsBogey.winsVsOpponent).toBe(1);
    expect(vsBogey.playerTotalWins).toBe(20);
    expect(vsBogey.opponentShare).toBeCloseTo(0.05, 6);
    expect(vsBogey.opponentModifier).toBeCloseTo(1, 10);
    expect(vsBogey.finalPointsFromWinsVsOpponent).toBeCloseTo(
      vsBogey.rawPointsFromWinsVsOpponent,
      6,
    );
  });
});
