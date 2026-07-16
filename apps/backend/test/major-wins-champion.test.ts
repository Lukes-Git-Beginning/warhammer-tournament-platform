/**
 * Unit tests for the major-wins champion resolver (pure, no DB). It must credit exactly
 * ONE winner per tournament — the decisive final winner — and for Balanced Liechtenstein
 * that is the TOP division's final winner, never a lower-division champion.
 */

import { describe, it, expect } from 'vitest';
import { tournamentChampion, type ChampionMatch } from '../src/routes/leaderboard.js';

const M = (o: Partial<ChampionMatch>): ChampionMatch => ({
  phase: null,
  status: 'COMPLETED',
  round: 1,
  winner_id: null,
  player1_id: null,
  player2_id: null,
  bracket_side: null,
  ...o,
});

describe('tournamentChampion — exactly one winner per major', () => {
  it('BaLi: credits the TOP-division final winner, never a lower division', () => {
    // Two parallel division finals: top band (5) and a lower band (3).
    const matches: ChampionMatch[] = [
      M({ phase: 'PLAYOFF_FINAL', winner_id: 'lowWinner', player1_id: 'lowWinner', player2_id: 'lowLoser', round: 6 }),
      M({ phase: 'PLAYOFF_FINAL', winner_id: 'topWinner', player1_id: 'topWinner', player2_id: 'topLoser', round: 6 }),
    ];
    const bands = new Map([
      ['topWinner', 5],
      ['topLoser', 5],
      ['lowWinner', 3],
      ['lowLoser', 3],
    ]);
    const champ = tournamentChampion('t', 'BALANCED_LIECHTENSTEIN', matches, bands, [...bands.keys()], new Set());
    expect(champ).toBe('topWinner');
  });

  it('Swiss+Playoff: the single playoff-final winner', () => {
    const matches: ChampionMatch[] = [
      M({ phase: 'PLAYOFF_SF', winner_id: 'a', player1_id: 'a', player2_id: 'b', round: 4 }),
      M({ phase: 'PLAYOFF_FINAL', winner_id: 'a', player1_id: 'a', player2_id: 'c', round: 5 }),
    ];
    const champ = tournamentChampion('t', 'SWISS', matches, new Map(), ['a', 'b', 'c'], new Set());
    expect(champ).toBe('a');
  });

  it('Single elimination: the grand final (top round) winner', () => {
    const matches: ChampionMatch[] = [
      M({ round: 1, winner_id: 'a', player1_id: 'a', player2_id: 'b' }),
      M({ round: 1, winner_id: 'c', player1_id: 'c', player2_id: 'd' }),
      M({ round: 2, winner_id: 'c', player1_id: 'a', player2_id: 'c' }),
    ];
    const champ = tournamentChampion('t', 'SINGLE_ELIMINATION', matches, new Map(), ['a', 'b', 'c', 'd'], new Set());
    expect(champ).toBe('c');
  });

  it('Double elimination: the GRAND_FINAL bracket winner', () => {
    const matches: ChampionMatch[] = [
      M({ round: 3, winner_id: 'w', player1_id: 'w', player2_id: 'x', bracket_side: 'WINNERS' }),
      M({ round: 5, winner_id: 'x', player1_id: 'w', player2_id: 'x', bracket_side: 'GRAND_FINAL' }),
    ];
    const champ = tournamentChampion('t', 'DOUBLE_ELIMINATION', matches, new Map(), ['w', 'x'], new Set());
    expect(champ).toBe('x');
  });

  it('pure Swiss (no playoff): the top of the final standings', () => {
    const matches: ChampionMatch[] = [
      M({ round: 1, winner_id: 'a', player1_id: 'a', player2_id: 'b' }),
      M({ round: 2, winner_id: 'a', player1_id: 'a', player2_id: 'c' }),
      M({ round: 3, winner_id: 'b', player1_id: 'b', player2_id: 'c' }),
    ];
    const champ = tournamentChampion('t', 'SWISS', matches, new Map(), ['a', 'b', 'c'], new Set());
    expect(champ).toBe('a'); // a is 2-0
  });

  it('ignores third-place matches and unfinished finals', () => {
    const matches: ChampionMatch[] = [
      M({ phase: 'PLAYOFF_THIRD_PLACE', winner_id: 'third', player1_id: 'third', player2_id: 'fourth', round: 5 }),
      M({ phase: 'PLAYOFF_FINAL', winner_id: 'champ', player1_id: 'champ', player2_id: 'runner', round: 5 }),
      M({ phase: 'PLAYOFF_FINAL', status: 'PENDING', winner_id: null, round: 5 }),
    ];
    const champ = tournamentChampion('t', 'SWISS', matches, new Map(), ['champ', 'runner', 'third', 'fourth'], new Set());
    expect(champ).toBe('champ');
  });
});
