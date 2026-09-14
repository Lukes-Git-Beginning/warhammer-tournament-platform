import { describe, it, expect } from 'vitest';
import {
  ScoringConfigSchema,
  computeSeriesStandingsA,
  computeSeriesQualifiersC,
  type SeriesGame,
  type QualifierPlacement,
} from '../src/lib/series-scoring.js';

const A = ScoringConfigSchema.parse({ model: 'A', points_per_game_played: 1, points_per_win: 1, final_size: 2 });

describe('computeSeriesStandingsA', () => {
  it('scores 1/game + 1/win and ranks by points', () => {
    // a beat b, a beat c, b beat c  → a: 2 games/2 wins=4; b: 2/1=3; c: 2/0=2
    const games: SeriesGame[] = [
      { player1Id: 'a', player2Id: 'b', winnerId: 'a' },
      { player1Id: 'a', player2Id: 'c', winnerId: 'a' },
      { player1Id: 'b', player2Id: 'c', winnerId: 'b' },
    ];
    const s = computeSeriesStandingsA(games, A, 'series-1');
    expect(s.map((r) => [r.competitorId, r.points])).toEqual([
      ['a', 4],
      ['b', 3],
      ['c', 2],
    ]);
    expect(s.find((r) => r.competitorId === 'a')?.qualified).toBe(true);
    expect(s.find((r) => r.competitorId === 'c')?.qualified).toBe(false);
  });

  it('rewards participation over win-rate (the "ponti effect")', () => {
    // p played 8 games, 0 wins → 8 pts. w played 4 games, 3 wins → 7 pts.
    const games: SeriesGame[] = [];
    for (let i = 0; i < 8; i++) games.push({ player1Id: 'p', player2Id: `o${i}`, winnerId: `o${i}` });
    for (let i = 0; i < 4; i++) games.push({ player1Id: 'w', player2Id: `x${i}`, winnerId: i < 3 ? 'w' : `x${i}` });
    const s = computeSeriesStandingsA(games, ScoringConfigSchema.parse({ model: 'A', final_size: 1 }), 'series-1');
    const p = s.find((r) => r.competitorId === 'p')!;
    const w = s.find((r) => r.competitorId === 'w')!;
    expect(p.points).toBe(8);
    expect(w.points).toBe(7);
    expect(p.rank).toBeLessThan(w.rank);
  });

  it('breaks a points tie by wins, then games', () => {
    // two players on 8 points: one with more wins ranks higher
    const games: SeriesGame[] = [
      // hi: 4 games, 4 wins → 8 pts
      ...Array.from({ length: 4 }, (_, i) => ({ player1Id: 'hi', player2Id: `a${i}`, winnerId: 'hi' })),
      // lo: 8 games, 0 wins → 8 pts
      ...Array.from({ length: 8 }, (_, i) => ({ player1Id: 'lo', player2Id: `b${i}`, winnerId: `b${i}` })),
    ];
    const s = computeSeriesStandingsA(games, ScoringConfigSchema.parse({ model: 'A', final_size: 1 }), 'series-1');
    const hi = s.find((r) => r.competitorId === 'hi')!;
    const lo = s.find((r) => r.competitorId === 'lo')!;
    expect(hi.points).toBe(8);
    expect(lo.points).toBe(8);
    expect(hi.rank).toBeLessThan(lo.rank); // wins tiebreak → hi first
  });

  it('is deterministic on a full tie via the random tiebreak', () => {
    const games: SeriesGame[] = [{ player1Id: 'x', player2Id: 'y', winnerId: null }]; // both 1 game, 0 wins
    const a = computeSeriesStandingsA(games, A, 'series-1');
    const b = computeSeriesStandingsA(games, A, 'series-1');
    expect(a.map((r) => r.competitorId)).toEqual(b.map((r) => r.competitorId));
  });
});

describe('computeSeriesQualifiersC', () => {
  const C = ScoringConfigSchema.parse({ model: 'C', top_x: 2 });

  it('takes Top-X per qualifier', () => {
    const q: QualifierPlacement[][] = [
      [
        { tournamentId: 't1', competitorId: 'a', position: 1 },
        { tournamentId: 't1', competitorId: 'b', position: 2 },
        { tournamentId: 't1', competitorId: 'c', position: 3 },
      ],
    ];
    const out = computeSeriesQualifiersC(q, C);
    expect(out.map((e) => e.competitorId)).toEqual(['a', 'b']);
    expect(out.map((e) => e.seed)).toEqual([1, 2]);
  });

  it('skips already-qualified players so the slot passes down', () => {
    const q: QualifierPlacement[][] = [
      [
        { tournamentId: 't1', competitorId: 'a', position: 1 },
        { tournamentId: 't1', competitorId: 'b', position: 2 },
      ],
      // a repeats in q2 but is already in → the two new slots go to c and d
      [
        { tournamentId: 't2', competitorId: 'a', position: 1 },
        { tournamentId: 't2', competitorId: 'c', position: 2 },
        { tournamentId: 't2', competitorId: 'd', position: 3 },
      ],
    ];
    const out = computeSeriesQualifiersC(q, C);
    expect(out.map((e) => e.competitorId)).toEqual(['a', 'b', 'c', 'd']);
    expect(out.find((e) => e.competitorId === 'c')?.fromTournamentId).toBe('t2');
  });
});
