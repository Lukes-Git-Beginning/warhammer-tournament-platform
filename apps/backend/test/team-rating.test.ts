/**
 * Unit tests for the 2v2 team-GS cold-start blend (members' average prior → team's own GS).
 */
import { describe, expect, it } from 'vitest';
import { resolveTeamGs } from '../src/lib/team-rating.js';

type Entry = { playerId: string; generalSkill: number; stdError: number; gamesCount: number };
const model = (generalSkills: Entry[]) => ({ generalSkills });

describe('resolveTeamGs', () => {
  it('returns null when neither the team nor its members are rated', () => {
    expect(resolveTeamGs(model([]), 'T', ['a', 'b'])).toBeNull();
  });

  it('starts at the members’ average when the team has no games of its own', () => {
    const gs = resolveTeamGs(
      model([
        { playerId: 'a', generalSkill: 1.0, stdError: 0.5, gamesCount: 20 },
        { playerId: 'b', generalSkill: 0.0, stdError: 0.5, gamesCount: 20 },
      ]),
      'T',
      ['a', 'b'],
    );
    expect(gs).not.toBeNull();
    expect(gs!.fromMembers).toBe(true);
    expect(gs!.provisional).toBe(true);
    expect(gs!.generalSkill).toBeCloseTo(0.5, 6); // avg of 1.0 and 0.0
    expect(gs!.gamesCount).toBe(0);
  });

  it('blends toward the team’s own fitted GS as it accrues games', () => {
    const gs = resolveTeamGs(
      model([
        { playerId: 'a', generalSkill: 1.0, stdError: 0.5, gamesCount: 20 },
        { playerId: 'b', generalSkill: 0.0, stdError: 0.5, gamesCount: 20 },
        { playerId: 'T', generalSkill: -1.0, stdError: 0.2, gamesCount: 25 },
      ]),
      'T',
      ['a', 'b'],
    );
    expect(gs!.generalSkill).toBeLessThan(0.5); // pulled below the 0.5 prior by strong data
    expect(gs!.provisional).toBe(false); // 25 own games ≥ prior-equivalent
    expect(gs!.gamesCount).toBe(25);
  });

  it('ignores unrated members in the prior average', () => {
    const gs = resolveTeamGs(
      model([{ playerId: 'a', generalSkill: 0.8, stdError: 0.5, gamesCount: 15 }]),
      'T',
      ['a', 'b'], // b has no entry
    );
    expect(gs!.generalSkill).toBeCloseTo(0.8, 6);
  });

  it('produces a band in 1..5', () => {
    const gs = resolveTeamGs(
      model([{ playerId: 'T', generalSkill: 2.0, stdError: 0.3, gamesCount: 30 }]),
      'T',
      ['a'],
    );
    expect(gs!.band).toBeGreaterThanOrEqual(1);
    expect(gs!.band).toBeLessThanOrEqual(5);
  });
});
