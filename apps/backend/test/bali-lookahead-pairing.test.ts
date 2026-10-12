/**
 * REPRODUCTION (2026-10-12) — enticity-presents-rizzottos-celebration-of-perfect-balance (BaLi, 5 rounds).
 *
 * Stelios (b4) fell a round behind (FoK withdrew from their R2 match, so he only played R2 later vs
 * Dniper) and Tobiaz (b4) waited for him in R3. From then on the two were two rounds behind the field,
 * and the planner did not see them: a round pool only counted players ONE round behind as "still
 * coming". So R4 and R5 looked closed while both still had to arrive there:
 *   - Briefumschlag got an R4 bye (#31) before Stelios–Tobiaz even started R3 (#32),
 *   - anderland got an R5 bye (#38) while Stelios–Tobiaz were still playing R3,
 *   - when the two finished, nobody was left in R4/R5 but each other → R4 (#39) and R5 (#40) were
 *     forced rematches (three meetings in a row), and BERRSERK (freed when TL withdrew) got a bye (#41).
 *
 * Each case below replays the planner at one of those moments with the real rows (players by name,
 * real skill bands). Withdrawn players are simply absent from the roster, exactly as in the tick.
 */

import { describe, it, expect } from 'vitest';
import { planPairings, type BalancedMatchRow, type BalancedParticipant } from '../src/lib/balanced-liechtenstein.js';

const BAND: Record<string, number> = {
  Maze: 5, Stelios: 4, Dniper: 2, Arkhan: 4, Brief: 3, sabayua: 3, Tobiaz: 4, anderland: 3,
  Dat: 5, Boss: 5, Berrserk: 5, Ahzek: 5, Chosen: 5, TL: 5, FoK: 5, Racar: 3, Alrik: 5,
};
const roster = (...names: string[]): BalancedParticipant[] => names.map((userId) => ({ userId, band: BAND[userId]! }));
const m = (round: number, p1: string, p2: string | null, status: string): BalancedMatchRow => ({
  round, player1_id: p1, player2_id: p2, status,
});
const TID = 'abc542ea-09a8-4fed-817b-1ae5540a6ef5';

/** Rounds 1–3 as they stood once everyone except Stelios/Tobiaz had finished R3. */
const R1_R3: BalancedMatchRow[] = [
  m(1, 'FoK', 'Boss', 'COMPLETED'), m(1, 'Berrserk', 'Maze', 'COMPLETED'), m(1, 'Ahzek', 'Dat', 'COMPLETED'),
  m(1, 'Dniper', 'anderland', 'COMPLETED'), m(1, 'Tobiaz', 'Racar', 'COMPLETED'), m(1, 'Arkhan', 'Stelios', 'COMPLETED'),
  m(1, 'Chosen', 'TL', 'COMPLETED'), m(1, 'Brief', 'sabayua', 'COMPLETED'), m(1, 'Alrik', null, 'CATCHUP_BYE'),
  m(2, 'Dat', 'Alrik', 'COMPLETED'), m(2, 'Racar', 'Brief', 'COMPLETED'), m(2, 'Chosen', 'Ahzek', 'COMPLETED'),
  m(2, 'Berrserk', 'TL', 'COMPLETED'), m(2, 'Maze', 'Boss', 'COMPLETED'), m(2, 'Tobiaz', 'Arkhan', 'COMPLETED'),
  m(2, 'FoK', 'Stelios', 'CANCELLED'), m(2, 'sabayua', 'anderland', 'COMPLETED'),
  m(3, 'Alrik', 'Berrserk', 'CANCELLED'), m(3, 'Dat', 'TL', 'COMPLETED'), m(3, 'Boss', 'Chosen', 'COMPLETED'),
  m(3, 'Maze', 'Ahzek', 'COMPLETED'), m(3, 'anderland', 'Brief', 'COMPLETED'), m(3, 'Racar', 'sabayua', 'COMPLETED'),
  m(3, 'Berrserk', 'Arkhan', 'COMPLETED'),
];
/** Round-4 matches of the front-runners (Briefumschlag was the odd one out). */
const R4 = (status: string): BalancedMatchRow[] => [
  m(4, 'Chosen', 'Maze', status), m(4, 'Boss', 'Ahzek', status), m(4, 'anderland', 'sabayua', status),
  m(4, 'Dat', 'Berrserk', status), m(4, 'Arkhan', 'TL', status),
];
const pairedWith = (plan: ReturnType<typeof planPairings>, a: string): string | undefined => {
  const p = plan.pairings.find((x) => x.player1_id === a || x.player2_id === a);
  return p ? (p.player1_id === a ? p.player2_id : p.player1_id) : undefined;
};

describe('BaLi lookahead — players two rounds behind still count as coming', () => {
  it('#31: does not bye Briefumschlag in R4 while Stelios, Tobiaz and Dniper still have to reach R4', () => {
    // Stelios–Dniper are still playing R2 (#18); Tobiaz waits for Stelios in the R3 pool.
    const rows = [...R1_R3, m(2, 'Dniper', 'Stelios', 'PENDING'), ...R4('PENDING')];
    const plan = planPairings(
      roster('Maze', 'Stelios', 'Dniper', 'Arkhan', 'Brief', 'sabayua', 'Tobiaz', 'anderland', 'Dat', 'Boss', 'Berrserk', 'Ahzek', 'Chosen', 'TL'),
      rows, 5, TID,
    );
    expect(plan.byes, `R4 should stay open for the late arrivals: ${JSON.stringify(plan.byes)}`).toEqual([]);
  });

  it('#38: does not bye anderland in R5 while Stelios–Tobiaz are still playing R3', () => {
    const rows = [
      ...R1_R3, m(2, 'Dniper', 'Stelios', 'COMPLETED'), ...R4('COMPLETED'),
      m(4, 'Brief', null, 'BYE'), m(3, 'Stelios', 'Tobiaz', 'PENDING'),
      m(5, 'Brief', 'sabayua', 'CANCELLED'), m(5, 'Maze', 'Dat', 'PENDING'), m(5, 'TL', 'Berrserk', 'PENDING'),
      m(5, 'Arkhan', 'sabayua', 'PENDING'),
    ];
    const plan = planPairings(roster('Maze', 'Stelios', 'Arkhan', 'Tobiaz', 'anderland', 'Dat', 'Berrserk', 'TL', 'sabayua'), rows, 5, TID);
    expect(plan.byes, `anderland must wait for Stelios/Tobiaz: ${JSON.stringify(plan.byes)}`).toEqual([]);
  });

  it('holds anderland and BERRSERK (after TL withdrew) for Stelios and Tobiaz instead of pairing them together', () => {
    // anderland (b3) and BERRSERK (b5) are free in R5; Stelios–Tobiaz (b4) are still in R3. Pairing
    // anderland–BERRSERK now (a Δ2) would leave the two b4s only each other in R5.
    const rows = [
      ...R1_R3, m(2, 'Dniper', 'Stelios', 'COMPLETED'), ...R4('COMPLETED'),
      m(4, 'Brief', null, 'BYE'), m(3, 'Stelios', 'Tobiaz', 'PENDING'),
      m(5, 'Brief', 'sabayua', 'CANCELLED'), m(5, 'Maze', 'Dat', 'PENDING'), m(5, 'TL', 'Berrserk', 'CANCELLED'),
      m(5, 'Arkhan', 'sabayua', 'PENDING'),
    ];
    const plan = planPairings(roster('Maze', 'Stelios', 'Arkhan', 'Tobiaz', 'anderland', 'Dat', 'Berrserk', 'sabayua'), rows, 5, TID);
    expect(plan.pairings.filter((p) => p.round === 5), 'nobody should be committed in R5 yet').toEqual([]);
    expect(plan.byes).toEqual([]);
  });

  it('pairs the arriving b4s with anderland and BERRSERK, never with each other', () => {
    const rows = [
      ...R1_R3, m(2, 'Dniper', 'Stelios', 'COMPLETED'), ...R4('COMPLETED'),
      m(4, 'Brief', null, 'BYE'), m(3, 'Stelios', 'Tobiaz', 'COMPLETED'), m(4, 'Stelios', 'Tobiaz', 'COMPLETED'),
      m(5, 'Brief', 'sabayua', 'CANCELLED'), m(5, 'Maze', 'Dat', 'COMPLETED'), m(5, 'TL', 'Berrserk', 'CANCELLED'),
      m(5, 'Arkhan', 'sabayua', 'COMPLETED'),
    ];
    const plan = planPairings(roster('Maze', 'Stelios', 'Arkhan', 'Tobiaz', 'anderland', 'Dat', 'Berrserk', 'sabayua'), rows, 5, TID);
    expect(pairedWith(plan, 'Stelios')).not.toBe('Tobiaz');
    expect(new Set([pairedWith(plan, 'anderland'), pairedWith(plan, 'Berrserk')])).toEqual(new Set(['Stelios', 'Tobiaz']));
    expect(plan.byes).toEqual([]);
  });
});

describe('BaLi closed-pool bye pick — never trades a play-up for an immediate rematch', () => {
  it('byes one of the two b4s (not the weakest) when byeing the weakest would force them to replay', () => {
    // The R4 pool once the fix holds Briefumschlag for the late pair: Brief (b3), Stelios + Tobiaz
    // (b4, who just met in R3). The weakest-first picker ranks Brief first — but byeing Brief leaves
    // Stelios–Tobiaz as the only pairing, an immediate rematch. A Δ1 play-up is always preferred.
    const others = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6']; // opponents who have left (not in the roster)
    const rows = [
      m(1, 'Brief', others[0]!, 'COMPLETED'), m(1, 'Stelios', others[1]!, 'COMPLETED'), m(1, 'Tobiaz', others[2]!, 'COMPLETED'),
      m(2, 'Brief', others[3]!, 'COMPLETED'), m(2, 'Stelios', others[4]!, 'COMPLETED'), m(2, 'Tobiaz', others[5]!, 'COMPLETED'),
      m(3, 'Brief', others[0]!, 'COMPLETED'), m(3, 'Stelios', 'Tobiaz', 'COMPLETED'),
    ];
    const weakestFirst = (ids: string[]) => [...ids].sort((a, b) => BAND[a]! - BAND[b]!);
    const plan = planPairings(roster('Brief', 'Stelios', 'Tobiaz'), rows, 5, TID, weakestFirst);
    expect(pairedWith(plan, 'Stelios'), `no immediate rematch: ${JSON.stringify(plan)}`).not.toBe('Tobiaz');
    expect(plan.byes.map((b) => b.player_id)).not.toContain('Brief');
    expect(plan.pairings).toHaveLength(1);
  });
});
