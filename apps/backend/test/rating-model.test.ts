/**
 * Unit tests for the L2-regularised logistic-regression rating model.
 *
 * Covers Alex-Spec properties (mirror matchup = 0, reverse matchup = negation,
 * dynamic recalculation) plus optimiser guarantees: convergence, shrinkage,
 * determinism, prediction symmetry, numerical stability and low-sample flags.
 */
import { describe, expect, it } from 'vitest';
import {
  fitRatingModel,
  createRatingModel,
  type MatchObservation,
} from '../src/lib/rating-model.js';
import { rawPoints } from '../src/lib/scoring-service.js';

// ---------------------------------------------------------------------------
// Helpers — build observations from A's (winner's) perspective.
// ---------------------------------------------------------------------------

function win(
  winnerId: string,
  winnerFaction: string,
  loserId: string,
  loserFaction: string,
): MatchObservation {
  return {
    playerAId: winnerId,
    factionXId: winnerFaction,
    playerBId: loserId,
    factionYId: loserFaction,
    aWon: true,
  };
}

/** N wins of `winner` on `wf` over distinct fresh opponents on `lf`. */
function dominate(winner: string, wf: string, lf: string, n: number): MatchObservation[] {
  return Array.from({ length: n }, (_, i) => win(winner, wf, `opp-${winner}-${i}`, lf));
}

// ---------------------------------------------------------------------------
// #2 Mirror matchup is always 0
// ---------------------------------------------------------------------------

describe('mirror matchup', () => {
  it('MatchupEffect(X, X) === 0', () => {
    const model = fitRatingModel([
      win('A', 'x', 'B', 'y'),
      win('B', 'y', 'A', 'x'),
      win('A', 'x', 'C', 'x'), // mirror x-vs-x contributes no ME param
    ]);
    expect(model.getMatchupEffect('x', 'x')).toBe(0);
    expect(model.getMatchupEffect('y', 'y')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// #3 Reverse matchup is the negation
// ---------------------------------------------------------------------------

describe('reverse matchup', () => {
  it('MatchupEffect(A, B) === -MatchupEffect(B, A)', () => {
    // x tends to beat y → non-trivial effect.
    const obs = [
      ...Array.from({ length: 10 }, (_, i) => win('p1', 'x', `q-${i}`, 'y')),
      ...Array.from({ length: 2 }, (_, i) => win(`r-${i}`, 'y', 'p1', 'x')),
    ];
    const model = fitRatingModel(obs);
    const xy = model.getMatchupEffect('x', 'y');
    const yx = model.getMatchupEffect('y', 'x');
    expect(Math.abs(xy)).toBeGreaterThan(0);
    expect(xy).toBeCloseTo(-yx, 10);
  });
});

// ---------------------------------------------------------------------------
// Optimiser: convergence
// ---------------------------------------------------------------------------

describe('convergence', () => {
  it('a player who keeps winning on a faction gets a higher skill, and loss drops', () => {
    // A beats B repeatedly in the x-mirror (no matchup effect → pure skill).
    const obs = Array.from({ length: 30 }, () => win('A', 'x', 'B', 'x'));
    const model = fitRatingModel(obs);
    expect(model.getPlayerFactionSkill('A', 'x')).toBeGreaterThan(
      model.getPlayerFactionSkill('B', 'x'),
    );
    // Final loss is below the all-0.5 baseline (N·ln2).
    expect(model.finalLoss).toBeLessThan(obs.length * Math.LN2);
  });
});

// ---------------------------------------------------------------------------
// Optimiser: shrinkage (low sample → smaller magnitude)
// ---------------------------------------------------------------------------

describe('shrinkage', () => {
  it('a 2-game winner has a smaller skill magnitude than a 50-game winner', () => {
    const obs = [...dominate('few', 'x', 'y', 2), ...dominate('many', 'x', 'y', 50)];
    const model = fitRatingModel(obs);
    const few = Math.abs(model.getPlayerFactionSkill('few', 'x'));
    const many = Math.abs(model.getPlayerFactionSkill('many', 'x'));
    expect(many).toBeGreaterThan(few);
  });
});

// ---------------------------------------------------------------------------
// Optimiser: determinism (cacheable)
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('identical observations produce identical parameters', () => {
    const obs = [...dominate('A', 'x', 'y', 12), ...dominate('B', 'y', 'x', 7)];
    const m1 = fitRatingModel(obs);
    const m2 = fitRatingModel(obs);
    expect(m1.getPlayerFactionSkill('A', 'x')).toBe(m2.getPlayerFactionSkill('A', 'x'));
    expect(m1.getMatchupEffect('x', 'y')).toBe(m2.getMatchupEffect('x', 'y'));
    expect(m1.finalLoss).toBe(m2.finalLoss);
  });
});

// ---------------------------------------------------------------------------
// Prediction symmetry + stability + low-sample flags
// ---------------------------------------------------------------------------

describe('expectedChanceToWin', () => {
  it('p(A beats B) + p(B beats A) === 1', () => {
    const model = fitRatingModel([...dominate('A', 'x', 'y', 15), ...dominate('C', 'z', 'x', 4)]);
    const pAB = model.expectedChanceToWin('A', 'x', 'C', 'z');
    const pBA = model.expectedChanceToWin('C', 'z', 'A', 'x');
    expect(pAB + pBA).toBeCloseTo(1, 10);
  });

  it('unknown players default to a 50% prediction', () => {
    const model = fitRatingModel([]);
    expect(model.playerFactionSkills).toHaveLength(0);
    expect(model.matchupEffects).toHaveLength(0);
    expect(model.expectedChanceToWin('ghost', 'x', 'phantom', 'y')).toBeCloseTo(0.5, 10);
  });
});

describe('numerical stability', () => {
  it('100 straight wins yield a finite, bounded skill (L2 prevents +inf)', () => {
    const model = fitRatingModel(dominate('A', 'x', 'y', 100));
    const skill = model.getPlayerFactionSkill('A', 'x');
    expect(Number.isFinite(skill)).toBe(true);
    expect(Math.abs(skill)).toBeLessThan(10);
  });
});

describe('lowSampleWarning', () => {
  it('flags player-factions below the threshold and clears above it', () => {
    const obs = [...dominate('few', 'x', 'y', 3), ...dominate('plenty', 'x', 'y', 6)];
    const model = fitRatingModel(obs); // default lowSampleThreshold = 5
    const few = model.playerFactionSkills.find((e) => e.playerId === 'few' && e.factionId === 'x')!;
    const plenty = model.playerFactionSkills.find(
      (e) => e.playerId === 'plenty' && e.factionId === 'x',
    )!;
    expect(few.lowSampleWarning).toBe(true);
    expect(plenty.lowSampleWarning).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// #8 Dynamic recalculation — changing model values changes the win's worth.
// ---------------------------------------------------------------------------

describe('dynamic recalculation', () => {
  it('the same match is worth different points under different matchup effects', () => {
    const base = {
      playerFactionSkills: [],
      fitIterations: 0,
      finalLoss: 0,
      totalMatches: 1,
    };
    const neutral = createRatingModel({
      ...base,
      matchupEffects: [{ factionXId: 'a', factionYId: 'b', effect: 0, sampleSize: 1, lowSampleWarning: false }],
    });
    const favoured = createRatingModel({
      ...base,
      matchupEffects: [{ factionXId: 'a', factionYId: 'b', effect: 2, sampleSize: 1, lowSampleWarning: false }],
    });

    const pNeutral = neutral.expectedChanceToWin('A', 'a', 'B', 'b'); // 0.5
    const pFavoured = favoured.expectedChanceToWin('A', 'a', 'B', 'b'); // > 0.5

    expect(pNeutral).toBeCloseTo(0.5, 10);
    expect(pFavoured).toBeGreaterThan(0.5);
    // A favoured win is worth fewer raw points than a coin-flip win.
    expect(rawPoints(pFavoured)).toBeLessThan(rawPoints(pNeutral));
  });
});
