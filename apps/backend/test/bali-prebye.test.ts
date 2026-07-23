// Regression: the pre-assigned bye (Alex 2026-07-23) must route the odd-count bye to the
// picked (weakest) player BEFORE the Blossom runs, so a lone weak player takes a bye instead
// of a hopeless big play-up. Mirrors the enticity-monday R5 case where xtofervs (b1) had his
// only fresh band-near partner used up and otherwise landed a Δ3.
import { describe, it, expect } from 'vitest';
import { planPairings, type BalancedMatchRow, type BalancedParticipant } from '../src/lib/balanced-liechtenstein.js';

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
