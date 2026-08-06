/**
 * BaLi immediate-rematch via a still-ONGOING match (the-dimwitted-ones-balanced-liechtenstein R2).
 *
 * RizzOtto & PJsforshort played each other in R1 and finished LAST; while they were still
 * playing, the engine didn't know they were opponents (only COMPLETED matches register a
 * last-opponent), so it treated RizzOtto–PJs as a valid R2 pairing, reserved it, and
 * committed the other b3 players' partners — stranding RizzOtto & PJs into a forced
 * immediate rematch once they finished.
 *
 * A match in progress already fixes who a player will have "just played" when they enter the
 * NEXT round's pool, so the immediate-rematch block must fire from ONGOING matches too.
 */

import { describe, it, expect } from 'vitest';
import {
  planPairings,
  type BalancedParticipant,
  type BalancedMatchRow,
} from '../src/lib/balanced-liechtenstein.js';

const parts: BalancedParticipant[] = [
  { userId: 'Soccer', band: 3 },
  { userId: 'sirV', band: 3 },
  { userId: 'Darren', band: 3 },
  { userId: 'RizzOtto', band: 3 },
  { userId: 'PJs', band: 3 },
  { userId: 'Bendalf', band: 2 },
];

/** State the instant the other b3 have finished R1 but RizzOtto–PJs are STILL playing. */
function baseMatches(): BalancedMatchRow[] {
  return [
    { round: 1, player1_id: 'Soccer', player2_id: 'Reck', status: 'COMPLETED' }, // Reck not in roster → just advances Soccer
    { round: 1, player1_id: 'sirV', player2_id: 'Darren', status: 'COMPLETED' }, // sirV–Darren played → R2 rematch blocked
    { round: 1, player1_id: 'Bendalf', player2_id: 'GenJAR', status: 'COMPLETED' },
    { round: 1, player1_id: 'RizzOtto', player2_id: 'PJs', status: 'ONGOING' }, // still playing each other
  ];
}

/** Drive the incremental flow for one seed: plan while RizzOtto–PJs are ONGOING, apply,
 *  finish them, re-plan — then report whether R2 force-rematched them. */
function rematchesFor(seed: string): boolean {
  const matches = baseMatches();
  const plan1 = planPairings(parts, matches, 4, seed);
  for (const p of plan1.pairings) {
    matches.push({ round: p.round, player1_id: p.player1_id, player2_id: p.player2_id, status: 'ONGOING' });
  }
  for (const m of matches) {
    if (m.round === 1 && m.player1_id === 'RizzOtto' && m.player2_id === 'PJs') m.status = 'COMPLETED';
  }
  const plan2 = planPairings(parts, matches, 4, seed);
  return plan2.pairings.some(
    (p) =>
      p.round === 2 &&
      ((p.player1_id === 'RizzOtto' && p.player2_id === 'PJs') ||
        (p.player1_id === 'PJs' && p.player2_id === 'RizzOtto')),
  );
}

// The real prod seed + a spread — the bug is tie-break-dependent, so we sweep many.
const SEEDS = ['22d3caa0-e0bc-4c42-ab28-aea1265dda68', ...Array.from({ length: 60 }, (_, i) => `s${i}`)];

describe('BaLi — a still-ONGOING match blocks the next-round rematch', () => {
  it('never force-rematches two players still playing each other, on ANY tie-break seed', () => {
    const bad = SEEDS.filter((s) => rematchesFor(s));
    console.log(`[dimwit] rematch on ${bad.length}/${SEEDS.length} seeds: ${JSON.stringify(bad.slice(0, 8))}`);
    expect(bad, 'no seed may force the RizzOtto–PJs immediate rematch').toEqual([]);
  });
});
