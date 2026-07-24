// Regression: the pre-assigned bye (Alex 2026-07-23) must route the odd-count bye to the
// picked (weakest) player BEFORE the Blossom runs, so a lone weak player takes a bye instead
// of a hopeless big play-up. Mirrors the enticity-monday R5 case where xtofervs (b1) had his
// only fresh band-near partner used up and otherwise landed a Δ3.
import { describe, it, expect } from 'vitest';
import { planPairings, type BalancedMatchRow, type BalancedParticipant } from '../src/lib/balanced-liechtenstein.js';
import { isLegalLateJoinReclaim } from '../src/lib/bali-pairing-cost.js';

const p = (userId: string, band: number): BalancedParticipant => ({ userId, band });

describe('BaLi pre-assigned bye', () => {
  it('routes the odd-count bye to the picked player and avoids the play-up', () => {
    // 5 players entering round 2. A(b1) already met B(b3) in round 1 → his only fresh
    // near partner is gone; a Blossom-leftover bye could shove him into a Δ2+. E had the
    // round-1 bye (so must not be byed again). The picker chooses A (weakest, no prior bye).
    const participants = [p('A', 1), p('B', 3), p('C', 3), p('D', 5), p('E', 5)];
    const matches: BalancedMatchRow[] = [
      { round: 1, player1_id: 'A', player2_id: 'B', status: 'COMPLETED' },
      { round: 1, player1_id: 'C', player2_id: 'D', status: 'COMPLETED' },
      { round: 1, player1_id: 'E', player2_id: null, status: 'BYE' },
    ];
    const pickBye = (ids: string[]) => (ids.includes('A') ? 'A' : null);

    const plan = planPairings(participants, matches, 3, 't', pickBye);
    const r2 = plan.pairings.filter((x) => x.round === 2);
    const byes = plan.byes.filter((x) => x.round === 2).map((b) => b.player_id);

    expect(byes).toEqual(['A']); // the picked weak player takes the bye
    const bandOf: Record<string, number> = { A: 1, B: 3, C: 3, D: 5, E: 5 };
    const maxGap = Math.max(...r2.map((x) => Math.abs(bandOf[x.player1_id]! - bandOf[x.player2_id]!)));
    expect(maxGap).toBeLessThanOrEqual(1); // B-C + D-E are same-band → no play-up at all
    expect(r2).toHaveLength(2); // the other four are all paired
  });

  it('falls back to the Blossom-leftover bye when no picker is supplied', () => {
    // Five fresh same-band players in round 1, no picker → still a valid 2-pairs-+-1-bye plan.
    const participants = [p('A', 3), p('B', 3), p('C', 3), p('D', 3), p('E', 3)];
    const plan = planPairings(participants, [], 3, 't');
    expect(plan.byes.length).toBe(1);
    expect(plan.pairings.length).toBe(2);
  });

  it('never byes a player twice: the picker skips a player who already had one', () => {
    // A(b1) already had a bye; the picker must fall to the next-weakest eligible (here C, b3).
    const participants = [p('A', 1), p('B', 3), p('C', 3), p('D', 5), p('E', 5)];
    const matches: BalancedMatchRow[] = [
      { round: 1, player1_id: 'A', player2_id: null, status: 'BYE' },
      { round: 1, player1_id: 'B', player2_id: 'C', status: 'COMPLETED' },
      { round: 1, player1_id: 'D', player2_id: 'E', status: 'COMPLETED' },
    ];
    const hadBye = new Set(['A']);
    const pickBye = (ids: string[]) => ids.find((id) => !hadBye.has(id) && id === 'C') ?? null;
    const plan = planPairings(participants, matches, 3, 't', pickBye);
    const byes = plan.byes.filter((x) => x.round === 2).map((b) => b.player_id);
    expect(byes).not.toContain('A');
    expect(byes).toEqual(['C']);
  });
});

describe('isLegalLateJoinReclaim (#11 late-join reclaim gate)', () => {
  it('always allows a reclaim that involves no catching-up late joiner (normal formation)', () => {
    // Even a wide gap with no committed matches is fine when no late joiner is being accommodated.
    expect(isLegalLateJoinReclaim({ involvesCatchup: false, holderBand: 1, joinerBand: 5, roundMaxGap: 0, immediateRematch: false })).toBe(true);
  });

  it('rejects a late-join reclaim whose gap exceeds the round worst committed gap', () => {
    // holder b1 vs joiner b3 = Δ2, but the round worst existing gap is Δ1 → would be the biggest.
    expect(isLegalLateJoinReclaim({ involvesCatchup: true, holderBand: 1, joinerBand: 3, roundMaxGap: 1, immediateRematch: false })).toBe(false);
  });

  it('allows a late-join reclaim whose gap ties the round worst committed gap', () => {
    expect(isLegalLateJoinReclaim({ involvesCatchup: true, holderBand: 2, joinerBand: 3, roundMaxGap: 1, immediateRematch: false })).toBe(true);
  });

  it('rejects a late-join reclaim that would be an immediate rematch, even within the gap', () => {
    expect(isLegalLateJoinReclaim({ involvesCatchup: true, holderBand: 3, joinerBand: 3, roundMaxGap: 2, immediateRematch: true })).toBe(false);
  });

  it('with no committed matches yet (roundMaxGap 0) allows only a same-band late-join reclaim', () => {
    expect(isLegalLateJoinReclaim({ involvesCatchup: true, holderBand: 3, joinerBand: 3, roundMaxGap: 0, immediateRematch: false })).toBe(true);
    expect(isLegalLateJoinReclaim({ involvesCatchup: true, holderBand: 3, joinerBand: 4, roundMaxGap: 0, immediateRematch: false })).toBe(false);
  });
});
