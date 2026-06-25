import { describe, expect, it } from 'vitest';
import { pickMapPerPlayerNoRepeat } from '../src/routes/match-decision.js';

describe('pickMapPerPlayerNoRepeat', () => {
  it('never returns a map either player has already played (when alternatives exist)', () => {
    const pool = ['a', 'b', 'c', 'd', 'e'];
    const playedByEither = ['a', 'b', 'c'];
    for (let i = 0; i < 200; i++) {
      const picked = pickMapPerPlayerNoRepeat(pool, playedByEither, []);
      expect(picked).not.toBeNull();
      expect(playedByEither).not.toContain(picked);
      expect(pool).toContain(picked);
    }
  });

  it('falls back to within-match no-repeat when the pool is exhausted for both players', () => {
    const pool = ['a', 'b'];
    // Both players have collectively played every map; only "a" was played in THIS match.
    const picked = pickMapPerPlayerNoRepeat(pool, ['a', 'b'], ['a']);
    expect(picked).toBe('b'); // avoids the within-match repeat, accepts a cross-round repeat
  });

  it('falls back to the full pool when even within-match leaves nothing', () => {
    const picked = pickMapPerPlayerNoRepeat(['a'], ['a'], ['a']);
    expect(picked).toBe('a');
  });

  it('returns null for an empty pool', () => {
    expect(pickMapPerPlayerNoRepeat([], [], [])).toBeNull();
  });

  it('picks freely when nobody has played yet', () => {
    const pool = ['a', 'b', 'c'];
    const picked = pickMapPerPlayerNoRepeat(pool, [], []);
    expect(pool).toContain(picked);
  });
});
