/**
 * Unit tests for tournamentPodium (pure, no DB) — the ordered top finishers of a tournament's
 * HIGHEST-division playoff. This underpins Series Model-C qualification: qualify the top-X of the
 * highest band's playoff, reusing the same highest-band-final method as tournamentChampion.
 * Determinable cuts: 1, 2, 4, 8 always; 3 only with a third-place match; 5/6/7 are ambiguous.
 */

import { describe, it, expect } from 'vitest';
import { tournamentPodium, type ChampionMatch } from '../src/routes/leaderboard.js';

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

const pos = (podium: { userId: string; position: number }[], uid: string): number | undefined =>
  podium.find((p) => p.userId === uid)?.position;

describe('tournamentPodium — highest-division playoff ranking', () => {
  it('returns [] when there is no playoff final (caller falls back to standings)', () => {
    const matches = [M({ phase: 'PLAYOFF_SF', winner_id: 'a', player1_id: 'a', player2_id: 'b' })];
    expect(tournamentPodium(matches, new Map())).toEqual([]);
  });

  it('ranks 1/2 from the final', () => {
    const matches = [
      M({ phase: 'PLAYOFF_FINAL', winner_id: 'champ', player1_id: 'champ', player2_id: 'runner', round: 5 }),
    ];
    const podium = tournamentPodium(matches, new Map());
    expect(pos(podium, 'champ')).toBe(1);
    expect(pos(podium, 'runner')).toBe(2);
  });

  it('BaLi: uses the TOP-band final, never a lower division', () => {
    const matches = [
      M({ phase: 'PLAYOFF_FINAL', winner_id: 'lowW', player1_id: 'lowW', player2_id: 'lowL', round: 6 }),
      M({ phase: 'PLAYOFF_FINAL', winner_id: 'topW', player1_id: 'topW', player2_id: 'topL', round: 6 }),
    ];
    const bands = new Map([['topW', 5], ['topL', 5], ['lowW', 3], ['lowL', 3]]);
    const podium = tournamentPodium(matches, bands);
    expect(pos(podium, 'topW')).toBe(1);
    expect(pos(podium, 'topL')).toBe(2);
    // Lower-division finalists never make the highest-division podium.
    expect(pos(podium, 'lowW')).toBeUndefined();
    expect(pos(podium, 'lowL')).toBeUndefined();
  });

  it('third-place match ranks 3 vs 4 cleanly', () => {
    const matches = [
      M({ phase: 'PLAYOFF_FINAL', winner_id: 'a', player1_id: 'a', player2_id: 'b', round: 5 }),
      M({ phase: 'PLAYOFF_THIRD_PLACE', winner_id: 'c', player1_id: 'c', player2_id: 'd', round: 5 }),
    ];
    const podium = tournamentPodium(matches, new Map());
    expect(pos(podium, 'a')).toBe(1);
    expect(pos(podium, 'b')).toBe(2);
    expect(pos(podium, 'c')).toBe(3);
    expect(pos(podium, 'd')).toBe(4);
  });

  it('without a third-place match, both SF losers tie at 3 (so top-4 still takes both)', () => {
    const matches = [
      M({ phase: 'PLAYOFF_SF', winner_id: 'a', player1_id: 'a', player2_id: 'sfLoser1', round: 4 }),
      M({ phase: 'PLAYOFF_SF', winner_id: 'b', player1_id: 'b', player2_id: 'sfLoser2', round: 4 }),
      M({ phase: 'PLAYOFF_FINAL', winner_id: 'a', player1_id: 'a', player2_id: 'b', round: 5 }),
    ];
    const podium = tournamentPodium(matches, new Map());
    expect(pos(podium, 'a')).toBe(1);
    expect(pos(podium, 'b')).toBe(2);
    expect(pos(podium, 'sfLoser1')).toBe(3);
    expect(pos(podium, 'sfLoser2')).toBe(3);
    const top4 = podium.filter((p) => p.position <= 4).map((p) => p.userId);
    expect(top4).toEqual(expect.arrayContaining(['a', 'b', 'sfLoser1', 'sfLoser2']));
  });

  it('QF losers tie at 5 — a full top-8 cut takes the whole playoff', () => {
    const matches = [
      M({ phase: 'PLAYOFF_QF', winner_id: 'a', player1_id: 'a', player2_id: 'qf1', round: 3 }),
      M({ phase: 'PLAYOFF_QF', winner_id: 'b', player1_id: 'b', player2_id: 'qf2', round: 3 }),
      M({ phase: 'PLAYOFF_QF', winner_id: 'c', player1_id: 'c', player2_id: 'qf3', round: 3 }),
      M({ phase: 'PLAYOFF_QF', winner_id: 'd', player1_id: 'd', player2_id: 'qf4', round: 3 }),
      M({ phase: 'PLAYOFF_SF', winner_id: 'a', player1_id: 'a', player2_id: 'b', round: 4 }),
      M({ phase: 'PLAYOFF_SF', winner_id: 'c', player1_id: 'c', player2_id: 'd', round: 4 }),
      M({ phase: 'PLAYOFF_FINAL', winner_id: 'a', player1_id: 'a', player2_id: 'c', round: 5 }),
    ];
    const podium = tournamentPodium(matches, new Map());
    const top8 = new Set(podium.filter((p) => p.position <= 8).map((p) => p.userId));
    for (const uid of ['a', 'b', 'c', 'd', 'qf1', 'qf2', 'qf3', 'qf4']) {
      expect(top8.has(uid)).toBe(true);
    }
    for (const uid of ['qf1', 'qf2', 'qf3', 'qf4']) expect(pos(podium, uid)).toBe(5);
  });

  it('ignores a lower-division third-place / SF when picking the top podium', () => {
    const matches = [
      // Top band final + SF losers
      M({ phase: 'PLAYOFF_SF', winner_id: 'A', player1_id: 'A', player2_id: 'Asf', round: 4 }),
      M({ phase: 'PLAYOFF_FINAL', winner_id: 'A', player1_id: 'A', player2_id: 'B', round: 5 }),
      // Lower band third-place match — must be ignored
      M({ phase: 'PLAYOFF_THIRD_PLACE', winner_id: 'low', player1_id: 'low', player2_id: 'low2', round: 5 }),
    ];
    const bands = new Map([['A', 5], ['B', 5], ['Asf', 5], ['low', 2], ['low2', 2]]);
    const podium = tournamentPodium(matches, bands);
    expect(pos(podium, 'A')).toBe(1);
    expect(pos(podium, 'B')).toBe(2);
    // No same-band third-place match → SF loser ties at 3; lower-band players excluded.
    expect(pos(podium, 'Asf')).toBe(3);
    expect(pos(podium, 'low')).toBeUndefined();
    expect(pos(podium, 'low2')).toBeUndefined();
  });
});
