import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@tww3/db';
import {
  placementForRound,
  computeSingleElimPlacements,
  computeRankedPlacements,
  finalizeTournament,
} from '../src/lib/finalize-tournament.js';
import {
  getSizeMultiplier,
  calculateTournamentPoints,
} from '../src/lib/tournament-utils.js';

// ---------------------------------------------------------------------------
// placementForRound
// ---------------------------------------------------------------------------

describe('placementForRound', () => {
  it('totalRounds=3: round 3 loser → 2', () => {
    expect(placementForRound(3, 3)).toBe(2);
  });

  it('totalRounds=3: round 2 loser → 3', () => {
    expect(placementForRound(2, 3)).toBe(3);
  });

  it('totalRounds=3: round 1 loser → 5', () => {
    expect(placementForRound(1, 3)).toBe(5);
  });

  it('totalRounds=4: round 4 loser → 2', () => {
    expect(placementForRound(4, 4)).toBe(2);
  });

  it('totalRounds=4: round 3 loser → 3', () => {
    expect(placementForRound(3, 4)).toBe(3);
  });

  it('totalRounds=4: round 2 loser → 5', () => {
    expect(placementForRound(2, 4)).toBe(5);
  });

  it('totalRounds=4: round 1 loser → 9', () => {
    expect(placementForRound(1, 4)).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// getSizeMultiplier
// ---------------------------------------------------------------------------

describe('getSizeMultiplier', () => {
  it('8 → 0.75', () => expect(getSizeMultiplier(8)).toBe(0.75));
  it('16 → 0.75', () => expect(getSizeMultiplier(16)).toBe(0.75));
  it('17 → 1.0', () => expect(getSizeMultiplier(17)).toBe(1.0));
  it('33 → 1.25', () => expect(getSizeMultiplier(33)).toBe(1.25));
  it('65 → 1.5', () => expect(getSizeMultiplier(65)).toBe(1.5));
  it('7 → 0.5', () => expect(getSizeMultiplier(7)).toBe(0.5));
});

// ---------------------------------------------------------------------------
// calculateTournamentPoints
// ---------------------------------------------------------------------------

describe('calculateTournamentPoints', () => {
  it('placement=1, playerCount=8, isMajor=false → 75', () => {
    // base=100, mult=0.75 → 75
    expect(calculateTournamentPoints({ placement: 1, playerCount: 8, isMajor: false })).toBe(75);
  });

  it('placement=1, playerCount=17, isMajor=true → 150', () => {
    // base=100, mult=1.0*1.5=1.5 → 150
    expect(calculateTournamentPoints({ placement: 1, playerCount: 17, isMajor: true })).toBe(150);
  });

  it('placement=5, playerCount=32, isMajor=false → 20', () => {
    // base=20 (placement 5 <= 8), mult=1.0 (32 >= 17, < 33) → 20
    expect(calculateTournamentPoints({ placement: 5, playerCount: 32, isMajor: false })).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// computeSingleElimPlacements — 4-player bracket (2 rounds)
// ---------------------------------------------------------------------------

describe('computeSingleElimPlacements — 4-player bracket', () => {
  // Round 1: semi-finals
  //   Match 1: P1 beats P2 (P2 out → placement 3)
  //   Match 2: P3 beats P4 (P4 out → placement 3)
  // Round 2: final
  //   Match 3: P1 beats P3 (P3 out → placement 2, P1 → placement 1)
  const matches = [
    { round: 1, player1_id: 'P1', player2_id: 'P2', winner_id: 'P1', status: 'COMPLETED' },
    { round: 1, player1_id: 'P3', player2_id: 'P4', winner_id: 'P3', status: 'COMPLETED' },
    { round: 2, player1_id: 'P1', player2_id: 'P3', winner_id: 'P1', status: 'COMPLETED' },
  ];

  it('winner P1 → placement 1', () => {
    const result = computeSingleElimPlacements(matches);
    expect(result.get('P1')).toBe(1);
  });

  it('final loser P3 → placement 2', () => {
    const result = computeSingleElimPlacements(matches);
    expect(result.get('P3')).toBe(2);
  });

  it('semi losers P2 and P4 → placement 3', () => {
    const result = computeSingleElimPlacements(matches);
    expect(result.get('P2')).toBe(3);
    expect(result.get('P4')).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// computeRankedPlacements — Swiss-style
// ---------------------------------------------------------------------------

describe('computeRankedPlacements', () => {
  it('sorts by wins desc, assigns joint placements on ties', () => {
    // P1: 3W 0L → place 1
    // P2: 2W 1L → place 2
    // P3: 1W 2L → place 3
    // P4: 0W 3L → place 4
    const participants = ['P1', 'P2', 'P3', 'P4'];
    const matches = [
      { round: 1, player1_id: 'P1', player2_id: 'P2', winner_id: 'P1', status: 'COMPLETED' },
      { round: 1, player1_id: 'P3', player2_id: 'P4', winner_id: 'P3', status: 'COMPLETED' },
      { round: 2, player1_id: 'P1', player2_id: 'P3', winner_id: 'P1', status: 'COMPLETED' },
      { round: 2, player1_id: 'P2', player2_id: 'P4', winner_id: 'P2', status: 'COMPLETED' },
      { round: 3, player1_id: 'P1', player2_id: 'P4', winner_id: 'P1', status: 'COMPLETED' },
      { round: 3, player1_id: 'P2', player2_id: 'P3', winner_id: 'P2', status: 'COMPLETED' },
    ];

    const result = computeRankedPlacements(participants, matches);
    expect(result.get('P1')).toBe(1);
    expect(result.get('P2')).toBe(2);
    expect(result.get('P3')).toBe(3);
    expect(result.get('P4')).toBe(4);
  });

  it('assigns joint placement for tied players', () => {
    // P1: 2W 0L → place 1
    // P2: 1W 1L, P3: 1W 1L → both place 2 (tie)
    // P4: 0W 2L → place 4
    const participants = ['P1', 'P2', 'P3', 'P4'];
    const matches = [
      { round: 1, player1_id: 'P1', player2_id: 'P2', winner_id: 'P1', status: 'COMPLETED' },
      { round: 1, player1_id: 'P3', player2_id: 'P4', winner_id: 'P3', status: 'COMPLETED' },
      { round: 2, player1_id: 'P1', player2_id: 'P3', winner_id: 'P1', status: 'COMPLETED' },
      { round: 2, player1_id: 'P2', player2_id: 'P4', winner_id: 'P2', status: 'COMPLETED' },
    ];

    const result = computeRankedPlacements(participants, matches);
    expect(result.get('P1')).toBe(1);
    // P2 and P3 both 1W 1L — joint placement 2
    expect(result.get('P2')).toBe(2);
    expect(result.get('P3')).toBe(2);
    // P4: 0W 2L → placement 4 (after two-way tie at 2)
    expect(result.get('P4')).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// finalizeTournament() integration — ELO written to DB
// ---------------------------------------------------------------------------

// Deterministic IDs for ELO integration tests
const ES = 'e0000000-0000-0000-0000-000000000001'; // season
const ET = 'e0000000-0000-0000-0000-000000000002'; // tournament
const EU1 = 'e0000000-0000-0000-0000-000000000011'; // user 1
const EU2 = 'e0000000-0000-0000-0000-000000000012'; // user 2
const EACTOR = 'e0000000-0000-0000-0000-000000000099';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ withSocket: false, withRedis: false, withCron: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

afterEach(async () => {
  // Clean up in reverse-dependency order
  await prisma.auditLog.deleteMany({ where: { entity_id: ET } });
  await prisma.tournamentResult.deleteMany({ where: { tournament_id: ET } });
  await prisma.match.deleteMany({ where: { tournament_id: ET } });
  await prisma.tournamentParticipant.deleteMany({ where: { tournament_id: ET } });
  await prisma.tournament.deleteMany({ where: { id: ET } });
  await prisma.leaderboardEntry.deleteMany({ where: { season_id: ES } });
  await prisma.season.deleteMany({ where: { id: ES } });
  await prisma.user.deleteMany({ where: { id: { in: [EU1, EU2, EACTOR] } } });
  await prisma.season.updateMany({ where: { is_active: true }, data: { is_active: false } });
});

async function seedEloBase({ withExistingLeaderboard = false }: { withExistingLeaderboard?: boolean } = {}) {
  await prisma.user.createMany({
    data: [
      { id: EU1, discord_id: 'elo_disc_1', username: 'EloAlpha', email: null },
      { id: EU2, discord_id: 'elo_disc_2', username: 'EloBeta', email: null },
      { id: EACTOR, discord_id: 'elo_disc_actor', username: 'EloAdmin', email: null },
    ],
    skipDuplicates: true,
  });

  // Deactivate any pre-existing active seasons to avoid interference
  await prisma.season.updateMany({ where: { is_active: true }, data: { is_active: false } });

  await prisma.season.create({
    data: {
      id: ES,
      name: 'ELO Test Season',
      start_date: new Date('2026-01-01'),
      end_date: new Date('2026-12-31'),
      is_active: true,
    },
  });

  await prisma.tournament.create({
    data: {
      id: ET,
      slug: 'elo-test-tournament',
      name: 'ELO Test Tournament',
      format: 'SWISS',
      status: 'ONGOING',
      start_date: new Date('2026-06-01'),
      timezone: 'Europe/Berlin',
      is_major: false,
      counts_for_leaderboard: true,
      organizer_id: EACTOR,
    },
  });

  await prisma.tournamentParticipant.createMany({
    data: [
      { tournament_id: ET, user_id: EU1, status: 'CHECKED_IN' },
      { tournament_id: ET, user_id: EU2, status: 'CHECKED_IN' },
    ],
  });

  // One completed match: EU1 beats EU2
  await prisma.match.create({
    data: {
      tournament_id: ET,
      round: 1,
      match_number: 1,
      player1_id: EU1,
      player2_id: EU2,
      winner_id: EU1,
      status: 'COMPLETED',
    },
  });

  if (withExistingLeaderboard) {
    // Pre-seed leaderboard ratings: EU1=1400, EU2=1200
    await prisma.leaderboardEntry.createMany({
      data: [
        { user_id: EU1, season_id: ES, total_points: 0, elo_rating: 1400, matches_played: 0, wins: 0, losses: 0 },
        { user_id: EU2, season_id: ES, total_points: 0, elo_rating: 1200, matches_played: 0, wins: 0, losses: 0 },
      ],
    });
  }
}

describe('finalizeTournament() — ELO integration', () => {
  it('writes non-zero elo_change to TournamentResult and updates elo_rating in LeaderboardEntry (equal start ratings)', async () => {
    await seedEloBase();
    await finalizeTournament(prisma, ET, EACTOR);

    // Both start at default 1200 — EU1 wins (Platz 1), EU2 loses (Platz 2)
    const results = await prisma.tournamentResult.findMany({ where: { tournament_id: ET } });
    const eu1Result = results.find((r) => r.user_id === EU1)!;
    const eu2Result = results.find((r) => r.user_id === EU2)!;

    // EU1 winner: +16, EU2 loser: -16 (2P equal ratings, K=32)
    expect(eu1Result.elo_change).toBe(16);
    expect(eu2Result.elo_change).toBe(-16);

    // Sum is zero-sum
    expect(eu1Result.elo_change + eu2Result.elo_change).toBe(0);

    // LeaderboardEntry elo_rating updated
    const entries = await prisma.leaderboardEntry.findMany({ where: { season_id: ES } });
    const eu1Entry = entries.find((e) => e.user_id === EU1)!;
    const eu2Entry = entries.find((e) => e.user_id === EU2)!;

    expect(eu1Entry.elo_rating).toBe(1216);
    expect(eu2Entry.elo_rating).toBe(1184);
  });

  it('respects pre-existing elo_rating from LeaderboardEntry (EU1=1400, EU2=1200, EU1 wins)', async () => {
    await seedEloBase({ withExistingLeaderboard: true });
    await finalizeTournament(prisma, ET, EACTOR);

    // E(1400,1200) = 1/(1+10^(-200/400)) = 0.75974
    // EU1 (1400) wins → delta = round(32*(1.0-0.75974)) = round(7.69) = 8
    // EU2 (1200) loses → delta = round(32*(0.0-0.24026)) = round(-7.69) = -8
    const results = await prisma.tournamentResult.findMany({ where: { tournament_id: ET } });
    const eu1Result = results.find((r) => r.user_id === EU1)!;
    const eu2Result = results.find((r) => r.user_id === EU2)!;

    expect(eu1Result.elo_change).toBe(8);
    expect(eu2Result.elo_change).toBe(-8);

    const entries = await prisma.leaderboardEntry.findMany({ where: { season_id: ES } });
    const eu1Entry = entries.find((e) => e.user_id === EU1)!;
    const eu2Entry = entries.find((e) => e.user_id === EU2)!;

    expect(eu1Entry.elo_rating).toBe(1408); // 1400 + 8
    expect(eu2Entry.elo_rating).toBe(1192); // 1200 - 8
  });
});
