import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';
import {
  placementForRound,
  computeSingleElimPlacements,
  computeRankedPlacements,
  computeDoubleElimPlacements,
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
// computeDoubleElimPlacements — pure-function tests
// ---------------------------------------------------------------------------
//
// 4-player DE round layout (as produced by the bracket generator):
//   WB R1:  rounds 1+2 (2 matches at round=1, 1 WB-final at round=2)
//   LB:     rounds 3–5 (LB-R1 at 3, LB-R2 at 4, LB-final at 5)
//   GF:     round 6  (bracket_side='GRAND_FINAL')
//   Reset:  round 7  (bracket_side='GRAND_FINAL', next_match_id=null)

describe('computeDoubleElimPlacements — edge: empty array', () => {
  it('returns empty Map for empty match array', () => {
    const result = computeDoubleElimPlacements([]);
    expect(result.size).toBe(0);
  });
});

describe('computeDoubleElimPlacements — Szenario A: WB-Champ wins GF, Reset=FORFEIT', () => {
  // 4-player DE model (rounds 1–7):
  //   WBC = WB-Champion; LBC = LB-Champion (GF runner-up); P3, P4 = eliminated earlier.
  //   WB R1 (round 1): WBC beats P4, LBC beats P3 → both P3+P4 drop to LB.
  //   WB Final (round 2): WBC beats LBC → LBC drops to LB.
  //   LB R1 (round 3): P4 beats P3 → P3 eliminated (placement 4).
  //   LB Semi (round 4): LBC beats P4 → P4 eliminated (placement 3).
  //   GF (round 6): WBC beats LBC → Reset triggered.
  //   Reset (round 7): FORFEIT (LBC concedes) → winner_id=null, status='FORFEIT'.
  //   championMatch = GF (round 6) because FORFEIT is excluded from COMPLETED filter.
  const matchesScenarioA = [
    { round: 1, player1_id: 'WBC', player2_id: 'P4',  winner_id: 'WBC', status: 'COMPLETED', bracket_side: 'WINNERS' },
    { round: 1, player1_id: 'LBC', player2_id: 'P3',  winner_id: 'LBC', status: 'COMPLETED', bracket_side: 'WINNERS' },
    { round: 2, player1_id: 'WBC', player2_id: 'LBC', winner_id: 'WBC', status: 'COMPLETED', bracket_side: 'WINNERS' },
    { round: 3, player1_id: 'P4',  player2_id: 'P3',  winner_id: 'P4',  status: 'COMPLETED', bracket_side: 'LOSERS'  },
    { round: 4, player1_id: 'LBC', player2_id: 'P4',  winner_id: 'LBC', status: 'COMPLETED', bracket_side: 'LOSERS'  },
    { round: 6, player1_id: 'WBC', player2_id: 'LBC', winner_id: 'WBC', status: 'COMPLETED', bracket_side: 'GRAND_FINAL' },
    { round: 7, player1_id: 'LBC', player2_id: 'WBC', winner_id: null,  status: 'FORFEIT',   bracket_side: 'GRAND_FINAL' },
  ];

  it('FORFEIT Reset is excluded → championMatch is GF (round 6)', () => {
    const result = computeDoubleElimPlacements(matchesScenarioA);
    // WBC is GF winner → placement 1
    expect(result.get('WBC')).toBe(1);
  });

  it('GF loser (LBC) → placement 2', () => {
    const result = computeDoubleElimPlacements(matchesScenarioA);
    expect(result.get('LBC')).toBe(2);
  });

  it('LB Semi loser (P4, round 4) → placement 3', () => {
    const result = computeDoubleElimPlacements(matchesScenarioA);
    // After champion match: remaining sorted desc: r4 (P4 loses), r3 (P3 loses), r2, r1
    // r4 loser = P4 → 3rd
    expect(result.get('P4')).toBe(3);
  });

  it('LB R1 loser (P3, round 3) → placement 4', () => {
    const result = computeDoubleElimPlacements(matchesScenarioA);
    // r3 loser = P3 → 4th
    expect(result.get('P3')).toBe(4);
  });

  it('exactly 4 placements assigned', () => {
    const result = computeDoubleElimPlacements(matchesScenarioA);
    expect(result.size).toBe(4);
  });
});

describe('computeDoubleElimPlacements — Szenario B: LB-Champ wins Reset (status=COMPLETED)', () => {
  // LBC beat WBC in GF (round 6) → Reset (round 7) is played.
  // LBC wins the Reset (round 7, status='COMPLETED').
  // championMatch = Reset (round 7, highest COMPLETED GRAND_FINAL).
  // Reset winner LBC → placement 1; Reset loser WBC → placement 2.
  const matchesScenarioB = [
    // WB R1 round=1
    { round: 1, player1_id: 'WBC', player2_id: 'P4',  winner_id: 'WBC', status: 'COMPLETED', bracket_side: 'WINNERS' },
    { round: 1, player1_id: 'LBC', player2_id: 'P3',  winner_id: 'LBC', status: 'COMPLETED', bracket_side: 'WINNERS' },
    // WB Final round=2
    { round: 2, player1_id: 'WBC', player2_id: 'LBC', winner_id: 'WBC', status: 'COMPLETED', bracket_side: 'WINNERS' },
    // LB R1 round=3
    { round: 3, player1_id: 'P4',  player2_id: 'P3',  winner_id: 'P4',  status: 'COMPLETED', bracket_side: 'LOSERS' },
    // LB Semi round=4
    { round: 4, player1_id: 'LBC', player2_id: 'P4',  winner_id: 'LBC', status: 'COMPLETED', bracket_side: 'LOSERS' },
    // Grand Final round=6 — LBC beats WBC (forces Reset)
    { round: 6, player1_id: 'WBC', player2_id: 'LBC', winner_id: 'LBC', status: 'COMPLETED', bracket_side: 'GRAND_FINAL' },
    // Reset round=7 — LBC beats WBC (LBC is champion)
    { round: 7, player1_id: 'LBC', player2_id: 'WBC', winner_id: 'LBC', status: 'COMPLETED', bracket_side: 'GRAND_FINAL' },
  ];

  it('Reset (round 7) is COMPLETED → championMatch is Reset, LBC → placement 1', () => {
    const result = computeDoubleElimPlacements(matchesScenarioB);
    expect(result.get('LBC')).toBe(1);
  });

  it('Reset loser WBC → placement 2', () => {
    const result = computeDoubleElimPlacements(matchesScenarioB);
    expect(result.get('WBC')).toBe(2);
  });

  it('LB Semi loser (P4, round 4) → placement 3', () => {
    const result = computeDoubleElimPlacements(matchesScenarioB);
    expect(result.get('P4')).toBe(3);
  });

  it('LB R1 loser (P3, round 3) → placement 4', () => {
    const result = computeDoubleElimPlacements(matchesScenarioB);
    expect(result.get('P3')).toBe(4);
  });

  it('exactly 4 placements assigned', () => {
    const result = computeDoubleElimPlacements(matchesScenarioB);
    expect(result.size).toBe(4);
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

}
