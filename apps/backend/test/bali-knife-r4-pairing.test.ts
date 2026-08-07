/**
 * "That's not a knife" R4 pairing forensics: the field's global optimum has NO Δ3, yet the
 * live engine committed Von_Carstein[b5] vs YaS[b2] (Δ3) while OneCreator[b4] was pulled into
 * Rogue Prince[b3] (Δ1). We (a) prove the static optimum is max Δ1, and (b) replay the real
 * R3-completion order to see whether/where the incremental commit strands Von_Carstein.
 */
import { describe, it, expect } from 'vitest';
import {
  planPairings,
  type BalancedParticipant,
  type BalancedMatchRow,
} from '../src/lib/balanced-liechtenstein.js';

const B: Record<string, number> = {
  VonC: 5, LeKart: 4, LordS: 4, OneCr: 4,
  Rizz: 3, ander: 3, Rogue: 3,
  Sarin: 2, Hyper: 2, Anas: 2, Troy: 2, YaS: 2, ICY: 2,
};
const parts: BalancedParticipant[] = Object.entries(B).map(([userId, band]) => ({ userId, band }));
const gap = (a: string, b: string) => Math.abs(B[a]! - B[b]!);

// Real R1–R3 (Melkor withdrew R2 → dummy opponent, not in roster). Encodes each player's
// completed=3 depth + real opponents (for the rematch constraints).
const C = (r: number, a: string, b: string | null, s = 'COMPLETED'): BalancedMatchRow => ({
  round: r, player1_id: a, player2_id: b, status: s,
});
const history: BalancedMatchRow[] = [
  // R1
  C(1, 'Rogue', 'Rizz'), C(1, 'VonC', 'Melkor'), C(1, 'YaS', 'Sarin'),
  C(1, 'Troy', 'ICY'), C(1, 'LordS', 'OneCr'), C(1, 'Anas', 'Hyper'),
  C(1, 'LeKart', null, 'BYE'), C(1, 'ander', null, 'CATCHUP_BYE'),
  // R2
  C(2, 'LeKart', 'OneCr'), C(2, 'LordS', 'Melkor'), C(2, 'Hyper', 'YaS'),
  C(2, 'Sarin', 'Anas'), C(2, 'Troy', 'Rizz'), C(2, 'Rogue', 'ICY'),
  C(2, 'VonC', null, 'BYE'), C(2, 'ander', null, 'CATCHUP_BYE'),
  // R3 (order below is the REAL played_at order)
  C(3, 'VonC', 'LeKart'), C(3, 'Sarin', 'Hyper'), C(3, 'Rogue', 'ander'),
  C(3, 'Troy', 'Anas'), C(3, 'OneCr', 'Rizz'), C(3, 'YaS', 'ICY'),
  C(3, 'LordS', null, 'BYE'),
];

const r4gaps = (matches: BalancedMatchRow[]) => {
  const r4 = matches.filter((m) => m.round === 4 && m.player1_id && m.player2_id);
  return r4.map((m) => ({ pair: `${m.player1_id}-${m.player2_id}`, gap: gap(m.player1_id!, m.player2_id!) }));
};

// Scored byes so far (never-bye-twice): LeKartoffel R1, VonC R2, LordS R3.
// (anderland06's CATCHUP_BYEs do NOT count — the deployed fix.) Excludes them from bye eligibility.
const ALREADY_BYED = ['LeKart', 'VonC', 'LordS'];
const pickBye = (ids: string[]): string[] => {
  const eligible = ids.filter((id) => !ALREADY_BYED.includes(id));
  return (eligible.length ? eligible : ids).slice();
};

describe('knife R4 — static global optimum has no Δ3', () => {
  it('WITHOUT never-bye-twice: the optimum simply byes the lone b5 (VonC) → max Δ1', () => {
    const plan = planPairings(parts, history, 4, 'knife-seed');
    const r4 = plan.pairings.filter((p) => p.round === 4).map((p) => ({ pair: `${p.player1_id}-${p.player2_id}`, gap: gap(p.player1_id, p.player2_id) }));
    console.log('[static/no-pickBye] R4 =', JSON.stringify(r4), 'byes=', JSON.stringify(plan.byes));
    expect(plan.byes.some((b) => b.player_id === 'VonC')).toBe(true);
  });

  it('WITH never-bye-twice (VonC already byed R2): does the engine give VonC Δ1 or stomp him at Δ3?', () => {
    const plan = planPairings(parts, history, 4, 'knife-seed', pickBye);
    const r4 = plan.pairings.filter((p) => p.round === 4).map((p) => ({ pair: `${p.player1_id}-${p.player2_id}`, gap: gap(p.player1_id, p.player2_id) }));
    const voncPair = r4.find((p) => p.pair.includes('VonC'));
    console.log('[static/pickBye] R4 =', JSON.stringify(r4), 'byes=', JSON.stringify(plan.byes));
    console.log('[static/pickBye] VonC =', JSON.stringify(voncPair));
    const maxGap = r4.reduce((mx, p) => Math.max(mx, p.gap), 0);
    console.log('[static/pickBye] maxGap =', maxGap);
    expect(voncPair).toBeDefined(); // VonC must play (can't bye twice)
  });
});

describe('knife R4 — replay the REAL R3 completion order', () => {
  it('reports whether the incremental engine strands Von_Carstein into a Δ3', () => {
    // R1+R2 committed; R3 starts ONGOING; complete R3 in the real played_at order, re-plan each tick.
    const r3Order = ['VonC|LeKart', 'Sarin|Hyper', 'Rogue|ander', 'Troy|Anas', 'OneCr|Rizz', 'YaS|ICY'];
    const matches: BalancedMatchRow[] = history.map((m) =>
      m.round === 3 && m.player2_id ? { ...m, status: 'ONGOING' } : { ...m },
    );
    const applyPlan = () => {
      const plan = planPairings(parts, matches, 4, 'knife-seed', pickBye, new Set(ALREADY_BYED));
      for (const p of plan.pairings) {
        if (!matches.some((m) => m.round === p.round && ((m.player1_id === p.player1_id && m.player2_id === p.player2_id) || (m.player1_id === p.player2_id && m.player2_id === p.player1_id)))) {
          matches.push({ round: p.round, player1_id: p.player1_id, player2_id: p.player2_id, status: 'ONGOING' });
        }
      }
    };
    applyPlan();
    for (const key of r3Order) {
      const [a, b] = key.split('|');
      const m = matches.find((x) => x.round === 3 && ((x.player1_id === a && x.player2_id === b) || (x.player1_id === b && x.player2_id === a)));
      if (m) m.status = 'COMPLETED';
      applyPlan();
    }
    const committed = r4gaps(matches);
    console.log('[staggered+fix] R4 committed =', JSON.stringify(committed));
    const vonc = committed.find((p) => p.pair.includes('VonC'));
    console.log('[staggered+fix] VonC pairing =', JSON.stringify(vonc));
    // FIX: with the never-bye-twice set force-matched, the incremental order no longer strands
    // VonC — he gets his Δ1 partner instead of a Δ3 stomp.
    const maxGap = committed.reduce((mx, p) => Math.max(mx, p.gap), 0);
    expect(maxGap).toBeLessThanOrEqual(1);
    expect(vonc?.gap).toBeLessThanOrEqual(1);
  });
});
