import { describe, expect, it } from 'vitest';
import {
  autoSwissConfig,
  balancedRounds,
  computeDynamicSize,
  downgradePlayoffFormat,
} from '../src/lib/auto-swiss-service.js';

describe('computeDynamicSize (#40 dynamic re-sizing)', () => {
  it('sizes from the active count when above the current round', () => {
    expect(computeDynamicSize(16, 1)).toEqual({ rounds: 4, playoffFormat: 'TOP8' });
    expect(computeDynamicSize(8, 2)).toEqual({ rounds: 5, playoffFormat: 'TOP4' });
    expect(computeDynamicSize(4, 1)).toEqual({ rounds: 3, playoffFormat: 'TOP2' });
  });

  it('never shrinks below the round already generated', () => {
    // 7 players → target 3 rounds, but round 4 was already set up: keep 4, then Top 2.
    expect(computeDynamicSize(7, 4)).toEqual({ rounds: 4, playoffFormat: 'TOP2' });
    // 16 players target 4 rounds, but a 5th was already generated → keep 5.
    expect(computeDynamicSize(16, 5)).toEqual({ rounds: 5, playoffFormat: 'TOP8' });
  });

  it('below 4 active: current round ends the event, no playoffs', () => {
    expect(computeDynamicSize(3, 2)).toEqual({ rounds: 2, playoffFormat: 'NONE' });
    expect(computeDynamicSize(3, 4)).toEqual({ rounds: 4, playoffFormat: 'NONE' });
    expect(computeDynamicSize(0, 0)).toEqual({ rounds: 0, playoffFormat: 'NONE' });
  });
});

describe('autoSwissConfig — Swiss + playoff = 7 total (intentional, non-BaLi)', () => {
  it('16+ → 4 Swiss + Top 8, 8+ → 5 Swiss + Top 4, 4+ → 3 Swiss + Top 2', () => {
    expect(autoSwissConfig(4)).toEqual({ rounds: 3, playoffFormat: 'TOP2' });
    expect(autoSwissConfig(8)).toEqual({ rounds: 5, playoffFormat: 'TOP4' });
    expect(autoSwissConfig(16)).toEqual({ rounds: 4, playoffFormat: 'TOP8' });
    expect(autoSwissConfig(3)).toBeNull(); // too few for a bracket
  });

  it('the 8+ tier deliberately has MORE Swiss rounds than 16+ (shorter playoff → same 7 total)', () => {
    // Guards the intent: do not "monotonic-fix" this — the total (Swiss + playoff rounds) is 7.
    const playoffRounds = { TOP2: 1, TOP4: 2, TOP8: 3, NONE: 0 } as const;
    for (const n of [8, 16]) {
      const cfg = autoSwissConfig(n)!;
      expect(cfg.rounds + playoffRounds[cfg.playoffFormat]).toBe(7);
    }
    expect(autoSwissConfig(8)!.rounds).toBeGreaterThan(autoSwissConfig(16)!.rounds);
  });
});

describe('balancedRounds — BaLi-specific sizing (3 under 8, 4 from 8 up)', () => {
  it('3 rounds under 8 players, 4 from 8 up', () => {
    expect(balancedRounds(4)).toBe(3);
    expect(balancedRounds(7)).toBe(3);
    expect(balancedRounds(8)).toBe(4);
    expect(balancedRounds(16)).toBe(4); // flat 4 — Top 8 does not apply to BaLi
    expect(balancedRounds(32)).toBe(4);
  });

  it('a tiny field (<4) never forces a rematch', () => {
    expect(balancedRounds(3)).toBe(2);
    expect(balancedRounds(2)).toBe(1);
    expect(balancedRounds(1)).toBe(1);
  });
});

describe('downgradePlayoffFormat — host ceiling, downgrade-only when the seeding pool is too small', () => {
  it('NEVER resurrects a playoff the host set to NONE (the reported bug: 6 Swiss, no playoffs → Top 4)', () => {
    // A host who chose NONE keeps NONE no matter how many players finish.
    expect(downgradePlayoffFormat('NONE', 0)).toBe('NONE');
    expect(downgradePlayoffFormat('NONE', 4)).toBe('NONE');
    expect(downgradePlayoffFormat('NONE', 8)).toBe('NONE');
    expect(downgradePlayoffFormat('NONE', 64)).toBe('NONE');
  });

  it('NEVER upgrades: a bigger field does not grow the host bracket', () => {
    expect(downgradePlayoffFormat('TOP4', 8)).toBe('TOP4');
    expect(downgradePlayoffFormat('TOP4', 16)).toBe('TOP4');
    expect(downgradePlayoffFormat('TOP2', 100)).toBe('TOP2');
  });

  it('keeps the host format when the pool exactly fills the bracket (8/4/2)', () => {
    expect(downgradePlayoffFormat('TOP8', 8)).toBe('TOP8');
    expect(downgradePlayoffFormat('TOP4', 4)).toBe('TOP4');
    expect(downgradePlayoffFormat('TOP2', 2)).toBe('TOP2');
  });

  it('downgrades step-by-step when the final pool is too small to fill the bracket', () => {
    // TOP8 needs 8; 5-7 left → Top 4; 2-3 left → Top 2; <2 → none.
    expect(downgradePlayoffFormat('TOP8', 7)).toBe('TOP4');
    expect(downgradePlayoffFormat('TOP8', 4)).toBe('TOP4');
    expect(downgradePlayoffFormat('TOP8', 3)).toBe('TOP2');
    expect(downgradePlayoffFormat('TOP8', 1)).toBe('NONE');
    // TOP4 needs 4; 2-3 left → Top 2; <2 → none.
    expect(downgradePlayoffFormat('TOP4', 3)).toBe('TOP2');
    expect(downgradePlayoffFormat('TOP4', 1)).toBe('NONE');
    // TOP2 needs 2; <2 → none.
    expect(downgradePlayoffFormat('TOP2', 1)).toBe('NONE');
  });

  it('treats null/unknown ceiling as no playoff', () => {
    expect(downgradePlayoffFormat(null, 8)).toBe('NONE');
  });
});
