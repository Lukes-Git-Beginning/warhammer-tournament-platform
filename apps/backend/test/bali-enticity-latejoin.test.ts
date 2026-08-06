/**
 * Enticity Wednesday Raffle (Free Pick) BaLi R2 Δ3 stomps — reproduction + fix (a).
 *
 * Real prod case (enticitys-wednesday-prize-raffle-tournament-free-pick-4): the closed R2
 * end-pool {Garrus b1, Leshy/GenJAR/Joey b2, Ahzek b5} was paired with FoK|Ahzek (a late
 * joiner) STOMPED at Δ3 (Ahzek–GenJAR) while a max-Δ1 pairing existed — because the
 * "never bye twice" rule counted Ahzek's R1 CATCHUP_BYE as a rest, so he was excluded from
 * the odd-round bye and force-paired into the far band. (That Δ3 then raised the round's
 * worst gap, letting a later Δ3 reclaim slip past isLegalLateJoinReclaim too.)
 *
 * Fix (a): a CATCHUP_BYE is a 0-point placeholder, not a rest → it must not count toward
 * "already byed". With the catch-up player back in the bye-candidate set, the existing
 * pre-bye optimiser (pairPool, `balanced-liechtenstein.ts`) byes HIM (fewest play-ups) and
 * the rest pair at Δ1.
 */

import { describe, it, expect } from 'vitest';
import {
  planPairings,
  type BalancedParticipant,
  type BalancedMatchRow,
} from '../src/lib/balanced-liechtenstein.js';

const BAND: Record<string, number> = {
  RizzOtto: 3, JoeyTendieTime: 2, Leshy: 2, GeneralJAR: 2, Troyaicarus: 2, Briefumschlag: 2,
  xtofervs: 2, Garrus: 1, Michu: 5, VonCarstein: 5, CHMO: 3, TL: 3, Ahzek: 5, FwX: 4,
};
const gapOf = (a: string, b: string): number => Math.abs(BAND[a]! - BAND[b]!);

/**
 * Mirror the service's `hadBye` + `pickBye`, toggling whether a CATCHUP_BYE counts as a
 * prior bye. `catchupCounts = true` = the OLD (buggy) behaviour; `false` = fix (a).
 */
function makePickBye(matches: BalancedMatchRow[], catchupCounts: boolean) {
  const byeStatuses = catchupCounts
    ? ['BYE', 'CATCHUP_BYE', 'PENDING_BYE']
    : ['BYE', 'PENDING_BYE'];
  const hadBye = new Set(
    matches
      .filter((m) => byeStatuses.includes(m.status) && m.player1_id && !m.player2_id)
      .map((m) => m.player1_id!),
  );
  return (candidateIds: string[]): string[] => {
    const eligible = candidateIds.filter((id) => !hadBye.has(id));
    const pool = eligible.length > 0 ? eligible : candidateIds;
    return [...pool].sort((a, b) => (BAND[a] ?? 5) - (BAND[b] ?? 5)); // weakest band first
  };
}

describe('Enticity late-join — the closed R2 end-pool stomp (fix a)', () => {
  // The real closed 5-player R2 pool: 4 leaders (played R1) + Ahzek (R1 catch-up bye).
  const parts: BalancedParticipant[] = [
    { userId: 'Garrus', band: 1 },
    { userId: 'Leshy', band: 2 },
    { userId: 'GeneralJAR', band: 2 },
    { userId: 'JoeyTendieTime', band: 2 },
    { userId: 'Ahzek', band: 5 },
  ];
  // R1: leaders paired among themselves (so no R2 rematch), Ahzek got a CATCHUP_BYE.
  const matches: BalancedMatchRow[] = [
    { round: 1, player1_id: 'Garrus', player2_id: 'Leshy', status: 'COMPLETED' },
    { round: 1, player1_id: 'GeneralJAR', player2_id: 'JoeyTendieTime', status: 'COMPLETED' },
    { round: 1, player1_id: 'Ahzek', player2_id: null, status: 'CATCHUP_BYE' },
  ];

  it('BUG: counting the CATCHUP_BYE excludes Ahzek from the bye → he is stomped at Δ3', () => {
    const plan = planPairings(parts, matches, 4, 'enticity-seed', makePickBye(matches, true));
    const r2 = plan.pairings.filter((p) => p.round === 2);
    const gaps = r2.map((p) => gapOf(p.player1_id, p.player2_id));
    console.log(`[bug] byes=${JSON.stringify(plan.byes)} pairs=${JSON.stringify(r2.map((p) => `${p.player1_id} vs ${p.player2_id}`))} gaps=${JSON.stringify(gaps)}`);
    expect(Math.max(...gaps)).toBe(3);
    // Ahzek is force-paired (not byed) because the CATCHUP_BYE excluded him.
    expect(plan.byes.some((b) => b.player_id === 'Ahzek')).toBe(false);
    expect(r2.some((p) => p.player1_id === 'Ahzek' || p.player2_id === 'Ahzek')).toBe(true);
  });

  it('FIX (a): ignoring the CATCHUP_BYE lets the optimiser bye Ahzek → rest pair at Δ1', () => {
    const plan = planPairings(parts, matches, 4, 'enticity-seed', makePickBye(matches, false));
    const r2 = plan.pairings.filter((p) => p.round === 2);
    const gaps = r2.map((p) => gapOf(p.player1_id, p.player2_id));
    console.log(`[fix] byes=${JSON.stringify(plan.byes)} pairs=${JSON.stringify(r2.map((p) => `${p.player1_id} vs ${p.player2_id}`))} gaps=${JSON.stringify(gaps)}`);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(1);           // no stomp
    expect(plan.byes.some((b) => b.player_id === 'Ahzek')).toBe(true); // the peerless catch-up player rests (→ reclaimable PENDING_BYE)
  });
});

describe('Enticity late-join — whole field present at once pairs cleanly (sanity)', () => {
  it('plans a max-Δ1 R2 when all 14 are present as completed=1', () => {
    const participants: BalancedParticipant[] = Object.entries(BAND).map(([userId, band]) => ({ userId, band }));
    const r1Real: Array<[string, string]> = [
      ['RizzOtto', 'JoeyTendieTime'], ['Leshy', 'GeneralJAR'], ['Troyaicarus', 'Briefumschlag'],
      ['xtofervs', 'Garrus'], ['Michu', 'VonCarstein'],
    ];
    const matches: BalancedMatchRow[] = [
      ...r1Real.map(([a, b]) => ({ round: 1, player1_id: a, player2_id: b, status: 'COMPLETED' })),
      ...['CHMO', 'TL', 'Ahzek', 'FwX'].map((p) => ({ round: 1, player1_id: p, player2_id: null, status: 'CATCHUP_BYE' })),
    ];
    const plan = planPairings(participants, matches, 4, 'enticity-seed');
    const r2 = plan.pairings.filter((p) => p.round === 2);
    const maxGap = r2.reduce((mx, p) => Math.max(mx, gapOf(p.player1_id, p.player2_id)), 0);
    expect(maxGap).toBeLessThanOrEqual(1);
  });
});
