import { describe, it, expect } from 'vitest';
import { projectBracketPlan } from '../src/lib/bracket-plan.js';

const bands = (spec: Record<number, number>): number[] =>
  Object.entries(spec).flatMap(([band, n]) => Array<number>(n).fill(Number(band)));

describe('projectBracketPlan', () => {
  it('Swiss / Auto Swiss: rounds_count + a single bracket at the effective playoff format', () => {
    expect(projectBracketPlan({ format: 'SWISS', playoffFormat: 'TOP4', roundsCount: 5, activeBands: bands({ 3: 10 }) }))
      .toEqual({ groupRounds: 5, divisions: [{ size: 4, format: 'TOP4' }] });
    // Fewer than 8 active → TOP4 falls back to TOP2, mirroring generatePlayoffBracket
    // (was a ghost TOP4 in the preview before the head-count fallback was applied here).
    expect(projectBracketPlan({ format: 'SWISS', playoffFormat: 'TOP4', roundsCount: 4, activeBands: bands({ 3: 3 }) }).divisions)
      .toEqual([{ size: 2, format: 'TOP2' }]);
  });

  it('Swiss TOP8 previews the effective format via the head-count fallback (NI-8a)', () => {
    // ≥16 active → TOP8 stands.
    expect(projectBracketPlan({ format: 'SWISS', playoffFormat: 'TOP8', roundsCount: 5, activeBands: bands({ 3: 16 }) }).divisions)
      .toEqual([{ size: 8, format: 'TOP8' }]);
    // <16 active → TOP4 (the reported bug: a 15-player field used to preview a ghost TOP8).
    expect(projectBracketPlan({ format: 'SWISS', playoffFormat: 'TOP8', roundsCount: 5, activeBands: bands({ 3: 15 }) }).divisions)
      .toEqual([{ size: 4, format: 'TOP4' }]);
    // <8 active → TOP2.
    expect(projectBracketPlan({ format: 'SWISS', playoffFormat: 'TOP8', roundsCount: 4, activeBands: bands({ 3: 6 }) }).divisions)
      .toEqual([{ size: 2, format: 'TOP2' }]);
  });

  it('Swiss with no playoff → no bracket divisions', () => {
    expect(projectBracketPlan({ format: 'AUTO_SWISS', playoffFormat: 'NONE', roundsCount: 3, activeBands: bands({ 3: 5 }) }).divisions)
      .toEqual([]);
  });

  it('classic Liechtenstein is projected like Swiss (single bracket)', () => {
    expect(projectBracketPlan({ format: 'LIECHTENSTEIN', playoffFormat: 'TOP2', roundsCount: 4, activeBands: bands({ 3: 6 }) }))
      .toEqual({ groupRounds: 4, divisions: [{ size: 2, format: 'TOP2' }] });
  });

  it('Balanced Liechtenstein: BaLi rounds + one division per band, shaped by pool size', () => {
    // 6 same-band → 3 rounds, one pool of 6 → TOP2 (final + 3rd).
    expect(projectBracketPlan({ format: 'BALANCED_LIECHTENSTEIN', playoffFormat: 'TOP2', roundsCount: null, activeBands: bands({ 3: 6 }) }))
      .toEqual({ groupRounds: 3, divisions: [{ size: 6, format: 'TOP2', band: 3 }] });
    // 8 same-band → 4 rounds, one pool of 8 → TOP4.
    expect(projectBracketPlan({ format: 'BALANCED_LIECHTENSTEIN', playoffFormat: 'TOP2', roundsCount: null, activeBands: bands({ 3: 8 }) }))
      .toEqual({ groupRounds: 4, divisions: [{ size: 8, format: 'TOP4', band: 3 }] });
  });

  it('BaLi splits into per-band divisions (TOP2 target size)', () => {
    // 4 band-5 + 4 band-3 → two full pools of 4, each a TOP2 bracket; 8 active → 4 rounds.
    const plan = projectBracketPlan({
      format: 'BALANCED_LIECHTENSTEIN', playoffFormat: 'TOP2', roundsCount: null, activeBands: bands({ 5: 4, 3: 4 }),
    });
    expect(plan.groupRounds).toBe(4);
    expect(plan.divisions).toEqual([{ size: 4, format: 'TOP2', band: 5 }, { size: 4, format: 'TOP2', band: 3 }]);
  });

  it('reprojects live as the field shrinks (BaLi 8 → 7 crosses the round tier)', () => {
    expect(projectBracketPlan({ format: 'BALANCED_LIECHTENSTEIN', playoffFormat: 'TOP2', roundsCount: null, activeBands: bands({ 3: 8 }) }).groupRounds).toBe(4);
    expect(projectBracketPlan({ format: 'BALANCED_LIECHTENSTEIN', playoffFormat: 'TOP2', roundsCount: null, activeBands: bands({ 3: 7 }) }).groupRounds).toBe(3);
  });
});
