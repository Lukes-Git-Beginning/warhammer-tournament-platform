/**
 * Unit tests for the skill-classification engine (questionnaire + Bayes blend).
 */
import { describe, expect, it } from 'vitest';
import {
  questionnaireFloor,
  bandToLogOdds,
  classify,
} from '../src/lib/skill-classification.js';

// ---------------------------------------------------------------------------
// Questionnaire floor — conservative-up MAX, cap-at-3 for volume/proxy
// ---------------------------------------------------------------------------

describe('questionnaireFloor', () => {
  it('takes the highest floor across all answers (conservative-up)', () => {
    expect(questionnaireFloor({ ranked_level: 'high', total_battles: '50_200' })).toBe(3); // max(3, 2)
  });

  it('defaults to band 1 with no (scoring) answers', () => {
    expect(questionnaireFloor({})).toBe(1);
    expect(questionnaireFloor({ nonsense: 'x' })).toBe(1); // non-scoring / unknown answer
  });

  it('caps volume/proxy questions at band 3 — cannot grind to Advanced/Elite', () => {
    const maxedOut = questionnaireFloor({
      total_battles: 'gt1000',
      domination_battles: 'gt200',
      steam_hours: 'gt1500',
      community: 'active',
      meta_familiarity: 'very_good',
      years_competitive: 'gt2y',
    });
    expect(maxedOut).toBe(3);
  });

  it('scores a semis-only NPT result as Beginner (band 2)', () => {
    expect(questionnaireFloor({ best_result: 'semis_npt' })).toBe(2);
  });

  it('reaches band 4 via achievement, top-of-ladder ranked, or self-rating; band 5 only via achievement or self-rating', () => {
    expect(questionnaireFloor({ best_result: 'won_open' })).toBe(4);
    expect(questionnaireFloor({ ranked_level: 'top_ladder' })).toBe(4);
    expect(questionnaireFloor({ self_rating: '4' })).toBe(4);
    expect(questionnaireFloor({ best_result: 'tt_top16' })).toBe(5);
    expect(questionnaireFloor({ self_rating: '5' })).toBe(5);
  });

  it('ignores unknown question ids and option values', () => {
    expect(questionnaireFloor({ nonsense: 'x', ranked_level: 'bogus' })).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Bayes blend — questionnaire prior vs data evidence
// ---------------------------------------------------------------------------

describe('classify — matchmaking blend', () => {
  it('with no games, the estimate is the questionnaire prior', () => {
    const c = classify(3, { generalSkill: null, stdError: null });
    expect(c.matchmakingSkill).toBeCloseTo(bandToLogOdds(3), 10);
    expect(c.matchmakingBand).toBe(3);
    expect(c.gatingBand).toBe(3);
    expect(c.smurfSuspected).toBe(false);
  });

  it('shifts from prior toward the data as the sample tightens', () => {
    const qFloor = 3; // prior ≈ 0.24 log-odds
    const thin = classify(qFloor, { generalSkill: 2.5, stdError: 1.5 }); // few games
    const thick = classify(qFloor, { generalSkill: 2.5, stdError: 0.3 }); // many games

    // Thick data pulls the posterior much closer to the observed 2.5.
    expect(Math.abs(thick.matchmakingSkill - 2.5)).toBeLessThan(
      Math.abs(thin.matchmakingSkill - 2.5),
    );
    // Thin data is still held back toward the prior.
    expect(thin.matchmakingSkill).toBeLessThan(thick.matchmakingSkill);
    // More evidence ⇒ tighter posterior.
    expect(thick.posteriorSe).toBeLessThan(thin.posteriorSe);
  });
});

// ---------------------------------------------------------------------------
// Gating — conservative anti-sandbag MAX
// ---------------------------------------------------------------------------

describe('classify — gating', () => {
  it('thin data cannot over-block a newcomer (conservative estimate stays low)', () => {
    // Looks decent (GS 1.5) but very uncertain → GS − 2·SE = −1.5 → band 1.
    const c = classify(1, { generalSkill: 1.5, stdError: 1.5 });
    expect(c.gatingBand).toBe(1);
    expect(c.smurfSuspected).toBe(false);
  });

  it('flags a smurf: a low claim contradicted by confident strong data', () => {
    // Claims New (1) but GS 2.0 with a tight SE 0.4 → GS − 0.8 = 1.2 → band 4.
    const c = classify(1, { generalSkill: 2.0, stdError: 0.4 });
    expect(c.gatingBand).toBe(4); // MAX(1, 4)
    expect(c.smurfSuspected).toBe(true);
  });

  it('accepts over-claiming (never auto-down): questionnaire wins, no smurf flag', () => {
    // Claims Top (5) with only modest data (GS 0.0, SE 0.5).
    const c = classify(5, { generalSkill: 0.0, stdError: 0.5 });
    expect(c.gatingBand).toBe(5); // questionnaire floor holds
    expect(c.smurfSuspected).toBe(false);
    // Matchmaking still blends down toward the real data.
    expect(c.matchmakingSkill).toBeLessThan(bandToLogOdds(5));
    expect(c.matchmakingSkill).toBeGreaterThan(0.0);
  });

  it('lets a strong player play a weak faction down: gating uses overall data, not the claim alone', () => {
    // A genuinely strong overall player (confident GS 1.5) claiming beginner is
    // still gated up by their data — the SFT faction-specific exception is applied
    // by the caller (passing faction data), not here.
    const c = classify(2, { generalSkill: 1.5, stdError: 0.4 });
    expect(c.gatingBand).toBeGreaterThanOrEqual(3); // MAX(2, band of 1.5−0.8=0.7 → 3)
  });
});

// ---------------------------------------------------------------------------
// Asymmetric soft floor — up fast, down slow (Alex, 2026-08-21)
// ---------------------------------------------------------------------------

describe('classify — asymmetric soft floor (matchmaking only)', () => {
  it('data above the questionnaire pulls the estimate up faster than equal data below pulls it down', () => {
    const qFloor = 3;
    const prior = bandToLogOdds(qFloor);
    const above = classify(qFloor, { generalSkill: prior + 1.0, stdError: 0.5 });
    const below = classify(qFloor, { generalSkill: prior - 1.0, stdError: 0.5 });
    const aboveMoved = (above.matchmakingSkill - prior) / 1.0; // fraction toward the +1 data
    const belowMoved = (prior - below.matchmakingSkill) / 1.0; // fraction toward the -1 data
    expect(aboveMoved).toBeGreaterThan(belowMoved); // up is faster than down
    expect(aboveMoved).toBeGreaterThan(0.5); // above: data is the majority almost at once
    expect(belowMoved).toBeLessThan(0.35); // below: the questionnaire floor resists
  });

  it('a sandbagger climbs faster than an over-claimer sinks (matched distance + confidence)', () => {
    const D = 1.5;
    const sandbagger = classify(2, { generalSkill: bandToLogOdds(2) + D, stdError: 0.5 }); // low claim, strong data
    const overClaimer = classify(4, { generalSkill: bandToLogOdds(4) - D, stdError: 0.5 }); // high claim, weak data
    const sandMoved = (sandbagger.matchmakingSkill - bandToLogOdds(2)) / D; // fraction climbed up
    const overMoved = (bandToLogOdds(4) - overClaimer.matchmakingSkill) / D; // fraction sunk down
    expect(sandMoved).toBeGreaterThan(overMoved);
  });

  it('leaves the gating (tournament-entry) band untouched — same MAX(floor, GS−2·SE) as before', () => {
    // Below-floor data: gating still floors at the questionnaire; above-floor confident data still lifts it.
    expect(classify(3, { generalSkill: -1.0, stdError: 0.5 }).gatingBand).toBe(3); // floor holds
    expect(classify(1, { generalSkill: 2.0, stdError: 0.4 }).gatingBand).toBe(4); // MAX(1, band(2.0−0.8))
  });
});
