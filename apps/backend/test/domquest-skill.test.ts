/**
 * Domquest skill start (Alex, 2026-10-27): no questionnaire block of its own. A player starts in Domquest
 * from his Domination standing, or from Conquest if he played more Conquest than Domination, and his own
 * Domquest games take over from there.
 */
import { describe, expect, it } from 'vitest';
import { fitRatingModel, type MatchObservation } from '../src/lib/rating-model.js';
import { CALIBRATION_QUESTIONS, pendingCalibrationTypes } from '../src/lib/skill-classification.js';
import { classifyWithModel, domquestReferenceType } from '../src/lib/skill-classification-service.js';

const F = 'f'; // one faction for everyone: the matchup term is a mirror, isolating the skill terms
function record(p: string, wins: number, losses: number, battleType: string): MatchObservation[] {
  const obs: MatchObservation[] = [];
  for (let i = 0; i < wins; i++) obs.push({ playerAId: p, factionXId: F, playerBId: `${battleType}-w-${i}`, factionYId: F, aWon: true, battleType });
  for (let i = 0; i < losses; i++) obs.push({ playerAId: `${battleType}-l-${i}`, factionXId: F, playerBId: p, factionYId: F, aWon: true, battleType });
  return obs;
}

const model = fitRatingModel(
  [
    ...record('dom', 160, 40, 'DOMINATION'),
    ...record('con', 2, 1, 'DOMINATION'),
    ...record('con', 10, 40, 'CONQUEST'),
    ...record('mixed', 120, 40, 'DOMINATION'),
    ...record('mixed', 3, 30, 'DOMQUEST'),
  ],
  { hierarchical: true },
);
const classify = (player: string, scope: Parameters<typeof classifyWithModel>[4]) =>
  classifyWithModel(model, {}, CALIBRATION_QUESTIONS, player, scope);

describe('Domquest skill start', () => {
  it('starts a Domination player at his Domination standing', () => {
    const dom = classify('dom', 'DOMINATION');
    const dq = classify('dom', 'DOMQUEST');
    expect(domquestReferenceType(model, 'dom')).toBe('DOMINATION');
    expect(dq.scopeGames).toBe(0);
    expect(dq.matchmakingSkill).toBeCloseTo(dom.matchmakingSkill, 6);
    expect(dq.gatingBand).toBe(dom.gatingBand);
    expect(dq.rated).toBe(true); // rated through his Domination games, not "Unrated"
  });

  it('starts from Conquest when the player has played more Conquest than Domination', () => {
    expect(domquestReferenceType(model, 'con')).toBe('CONQUEST');
    expect(classify('con', 'DOMQUEST').matchmakingSkill).toBeCloseTo(classify('con', 'CONQUEST').matchmakingSkill, 6);
  });

  it("lets the player's own Domquest games take over", () => {
    const dom = classify('mixed', 'DOMINATION');
    const dq = classify('mixed', 'DOMQUEST');
    expect(dq.scopeGames).toBe(33);
    expect(dq.matchmakingSkill).toBeLessThan(dom.matchmakingSkill); // 3–30 in Domquest pulls him down
  });

  it('never asks Domquest questions (no pending calibration block for it)', () => {
    expect(pendingCalibrationTypes({ general_pvp: 'some' })).not.toContain('DOMQUEST');
    expect(CALIBRATION_QUESTIONS.some((q) => q.battleTypes?.includes('DOMQUEST'))).toBe(false);
  });
});
