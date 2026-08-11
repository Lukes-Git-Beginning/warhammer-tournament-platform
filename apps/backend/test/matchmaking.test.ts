import { describe, it, expect } from 'vitest';
import {
  logit,
  chanceToWin,
  findBalancedFactions,
  unfairness,
  makeFactionTilt,
  type MatchmakingData,
} from '../src/lib/matchmaking.js';
import { logistic } from '../src/lib/rating-model.js';

// A hand-built stub so the scorer is testable without the model/DB.
function stub(
  skills: Record<string, number>,
  tilts: Record<string, { tilt: number; hasData: boolean }>,
): MatchmakingData {
  return {
    skillOf: (p, f) => skills[`${p}|${f}`] ?? 0,
    factionTilt: (x, y) => tilts[`${x}|${y}`] ?? { tilt: 0, hasData: false },
  };
}

describe('logit', () => {
  it('is the inverse of logistic and clamps the extremes (never ±∞)', () => {
    expect(logit(0.5)).toBeCloseTo(0);
    expect(logistic(logit(0.7))).toBeCloseTo(0.7);
    expect(Number.isFinite(logit(0))).toBe(true);
    expect(Number.isFinite(logit(1))).toBe(true);
  });
});

describe('makeFactionTilt', () => {
  it('uses the raw win-rate when the pair has games — no shrinkage', () => {
    // Slaanesh won 2 of 10 vs Bretonnia (Alex's counter example): tilt = logit(0.2), disfavoured.
    const tilt = makeFactionTilt(
      [{ faction_a_id: 'bretonnia', faction_b_id: 'slaanesh', faction_a_wins: 8, faction_b_wins: 2 }],
      new Map(),
    );
    const r = tilt('slaanesh', 'bretonnia');
    expect(r.hasData).toBe(true);
    expect(r.tilt).toBeCloseTo(logit(0.2));
    // antisymmetric — the reverse is exactly negated (so CtW stays symmetric)
    expect(tilt('bretonnia', 'slaanesh').tilt).toBeCloseTo(logit(0.8));
    expect(tilt('slaanesh', 'bretonnia').tilt).toBeCloseTo(-tilt('bretonnia', 'slaanesh').tilt);
  });

  it('falls back to the Model-Strength delta only at 0 games', () => {
    const tilt = makeFactionTilt([], new Map([['slaanesh', 0.6], ['bretonnia', 0.5]]));
    const r = tilt('slaanesh', 'bretonnia');
    expect(r.hasData).toBe(false);
    expect(r.tilt).toBeCloseTo(logit(0.6) - logit(0.5));
  });

  it('never-played with no Model-Strength either → neutral 0', () => {
    expect(makeFactionTilt([], new Map())('x', 'y')).toEqual({ tilt: 0, hasData: false });
  });

  it('a mirror matchup is a coin-flip', () => {
    expect(makeFactionTilt([], new Map())('x', 'x')).toEqual({ tilt: 0, hasData: false });
  });

  it('one decisive game still counts as data (Alex: trust even a small sample)', () => {
    const tilt = makeFactionTilt(
      [{ faction_a_id: 'a', faction_b_id: 'b', faction_a_wins: 1, faction_b_wins: 0 }],
      new Map(),
    );
    expect(tilt('a', 'b').hasData).toBe(true);
  });
});

describe('chanceToWin', () => {
  it('is symmetric: CtW(A,X vs B,Y) = 1 − CtW(B,Y vs A,X)', () => {
    const data = stub(
      { 'A|x': 0.5, 'B|y': -0.2 },
      { 'x|y': { tilt: logit(0.7), hasData: true }, 'y|x': { tilt: logit(0.3), hasData: true } },
    );
    const ab = chanceToWin(data, 'A', 'x', 'B', 'y');
    const ba = chanceToWin(data, 'B', 'y', 'A', 'x');
    expect(ab + ba).toBeCloseTo(1);
  });

  it('equal skill + neutral factions → 50%', () => {
    expect(chanceToWin(stub({}, {}), 'A', 'x', 'B', 'y')).toBeCloseTo(0.5);
  });
});

describe('findBalancedFactions', () => {
  const data = stub(
    {}, // equal skill everywhere
    {
      'x|y': { tilt: 0, hasData: true }, // 50% — balanced
      'x|w': { tilt: logit(0.75), hasData: true }, // 75% — off
      'z|y': { tilt: logit(0.3), hasData: true }, // 30% — off
      'z|w': { tilt: 0, hasData: true }, // 50% — balanced
    },
  );

  it('keeps only setups inside the band, closest to 50% first', () => {
    const setups = findBalancedFactions(data, 'A', 'B', ['x', 'z'], ['y', 'w']);
    expect(setups.map((s) => `${s.factionX}v${s.factionY}`)).toEqual(['xvy', 'zvw']);
    expect(setups.every((s) => Math.abs(s.ctw - 0.5) <= 0.025)).toBe(true);
  });

  it('requireData skips never-played pairs (challenge mode)', () => {
    const d = stub({}, { 'x|y': { tilt: 0, hasData: false } }); // the only balanced pair has no data
    expect(findBalancedFactions(d, 'A', 'B', ['x'], ['y'], { requireData: true })).toHaveLength(0);
    expect(findBalancedFactions(d, 'A', 'B', ['x'], ['y'], { requireData: false })).toHaveLength(1);
  });
});

describe('unfairness', () => {
  it('is 0 for a coin-flip and grows toward 0.5 for a lopsided matchup', () => {
    const fair = stub({}, { 'x|y': { tilt: 0, hasData: true } });
    const lopsided = stub({}, { 'x|y': { tilt: logit(0.95), hasData: true } });
    expect(unfairness(fair, 'A', 'x', 'B', 'y')).toBeCloseTo(0);
    expect(unfairness(lopsided, 'A', 'x', 'B', 'y')).toBeGreaterThan(0.4);
  });
});
