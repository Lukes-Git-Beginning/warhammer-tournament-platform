import { describe, expect, it } from 'vitest';
import { autoSwissConfig, computeDynamicSize } from '../src/lib/auto-swiss-service.js';

describe('computeDynamicSize (#40 dynamic re-sizing)', () => {
  it('sizes from the active count when above the current round', () => {
    expect(computeDynamicSize(16, 1)).toEqual({ rounds: 5, playoffFormat: 'TOP8' });
    expect(computeDynamicSize(8, 2)).toEqual({ rounds: 4, playoffFormat: 'TOP4' });
    expect(computeDynamicSize(4, 1)).toEqual({ rounds: 3, playoffFormat: 'TOP2' });
  });

  it('never shrinks below the round already generated', () => {
    // 7 players → target 3 rounds, but round 4 was already set up: keep 4, then Top 2.
    expect(computeDynamicSize(7, 4)).toEqual({ rounds: 4, playoffFormat: 'TOP2' });
    // 16 players target 5 rounds; a 5th is already generated → keep 5.
    expect(computeDynamicSize(16, 5)).toEqual({ rounds: 5, playoffFormat: 'TOP8' });
  });

  it('below 4 active: current round ends the event, no playoffs', () => {
    expect(computeDynamicSize(3, 2)).toEqual({ rounds: 2, playoffFormat: 'NONE' });
    expect(computeDynamicSize(3, 4)).toEqual({ rounds: 4, playoffFormat: 'NONE' });
    expect(computeDynamicSize(0, 0)).toEqual({ rounds: 0, playoffFormat: 'NONE' });
  });
});

describe('autoSwissConfig round/playoff tiers', () => {
  it('gives the expected rounds + playoff size per field size', () => {
    expect(autoSwissConfig(4)).toEqual({ rounds: 3, playoffFormat: 'TOP2' });
    expect(autoSwissConfig(8)).toEqual({ rounds: 4, playoffFormat: 'TOP4' });
    expect(autoSwissConfig(16)).toEqual({ rounds: 5, playoffFormat: 'TOP8' });
    expect(autoSwissConfig(3)).toBeNull(); // too few for a bracket
  });

  it('rounds never decrease as the field grows (monotonic — the old table was not)', () => {
    let prev = 0;
    for (let n = 4; n <= 64; n++) {
      const cfg = autoSwissConfig(n)!;
      expect(cfg.rounds).toBeGreaterThanOrEqual(prev);
      prev = cfg.rounds;
    }
  });
});
