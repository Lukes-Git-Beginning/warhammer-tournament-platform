import { describe, it, expect } from 'vitest';
import { projectBracketPlan } from '../src/lib/bracket-plan.js';

const bands = (spec: Record<number, number>): number[] =>
  Object.entries(spec).flatMap(([band, n]) => Array<number>(n).fill(Number(band)));

describe('projectBracketPlan', () => {
  it('Swiss / Auto Swiss: rounds_count + a single bracket at the playoff cutoff', () => {
    expect(projectBracketPlan({ format: 'SWISS', playoffFormat: 'TOP4', roundsCount: 5, activeBands: bands({ 3: 10 }) }))
      .toEqual({ groupRounds: 5, divisions: [{ size: 4, format: 'TOP4' }] });
    // Fewer active than the cutoff → the bracket shrinks to the field.
    expect(projectBracketPlan({ format: 'SWISS', playoffFormat: 'TOP4', roundsCount: 4, activeBands: bands({ 3: 3 }) }).divisions)
      .toEqual([{ size: 3, format: 'TOP4' }]);
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
      .toEqual({ groupRounds: 3, divisions: [{ size: 6, format: 'TOP2' }] });
    // 8 same-band → 4 rounds, one pool of 8 → TOP4.
    expect(projectBracketPlan({ format: 'BALANCED_LIECHTENSTEIN', playoffFormat: 'TOP2', roundsCount: null, activeBands: bands({ 3: 8 }) }))
      .toEqual({ groupRounds: 4, divisions: [{ size: 8, format: 'TOP4' }] });
  });

  it('BaLi splits into per-band divisions (TOP2 target size)', () => {
    // 4 band-5 + 4 band-3 → two full pools of 4, each a TOP2 bracket; 8 active → 4 rounds.
    const plan = projectBracketPlan({
      format: 'BALANCED_LIECHTENSTEIN', playoffFormat: 'TOP2', roundsCount: null, activeBands: bands({ 5: 4, 3: 4 }),
    });
    expect(plan.groupRounds).toBe(4);
    expect(plan.divisions).toEqual([{ size: 4, format: 'TOP2' }, { size: 4, format: 'TOP2' }]);
  });

  it('reprojects live as the field shrinks (BaLi 8 → 7 crosses the round tier)', () => {
    expect(projectBracketPlan({ format: 'BALANCED_LIECHTENSTEIN', playoffFormat: 'TOP2', roundsCount: null, activeBands: bands({ 3: 8 }) }).groupRounds).toBe(4);
    expect(projectBracketPlan({ format: 'BALANCED_LIECHTENSTEIN', playoffFormat: 'TOP2', roundsCount: null, activeBands: bands({ 3: 7 }) }).groupRounds).toBe(3);
  });
});
