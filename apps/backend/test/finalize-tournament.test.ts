import { describe, expect, it } from 'vitest';
import {
  placementForRound,
  computeSingleElimPlacements,
  computeRankedPlacements,
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
