import { describe, it, expect } from 'vitest';
import { combineFactionStatsAllTime } from '../src/lib/factions.js';
import type { FactionStatsDto } from '../src/lib/factions.js';

const stat = (matches: number, wins: number): FactionStatsDto => ({
  matches_played: matches,
  wins,
  losses: matches - wins,
  draws: 0,
  win_rate: matches > 0 ? wins / matches : null,
  pick_count: matches,
  ban_count: 0,
});

describe('combineFactionStatsAllTime (raw counts, 1/k-weighted win rate)', () => {
  it('returns null when the faction has no games in any version', () => {
    expect(combineFactionStatsAllTime([])).toBeNull();
    expect(combineFactionStatsAllTime([{ stats: stat(0, 0), weight: 1 }])).toBeNull();
  });

  it('sums RAW counts across versions (never fewer than one version) but weights only the win_rate', () => {
    // newest (weight 1/1): 10 games, 8 wins. previous (weight 1/2): 10 games, 2 wins.
    // Counts are raw: matches = 20, wins = 10. win_rate uses the weighted sums:
    // weighted matches = 10 + 5 = 15; weighted wins = 8 + 1 = 9 → 9/15 = 0.6.
    const c = combineFactionStatsAllTime([
      { stats: stat(10, 8), weight: 1 },
      { stats: stat(10, 2), weight: 1 / 2 },
    ])!;
    expect(c.matches_played).toBe(20);
    expect(c.wins).toBe(10);
    expect(c.win_rate).toBeCloseTo(0.6, 6);
  });

  it('devalues an older version — the recent record dominates the blended rate', () => {
    // 90% over 10 in the newest version, 10% over 10 in the 4th-newest (weight 1/4).
    // A naive unweighted blend would be 50%; the decay pulls it toward the recent 90%.
    const c = combineFactionStatsAllTime([
      { stats: stat(10, 9), weight: 1 },
      { stats: stat(10, 1), weight: 1 / 4 },
    ])!;
    expect(c.win_rate!).toBeGreaterThan(0.7);
  });
});
