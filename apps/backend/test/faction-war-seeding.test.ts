import { describe, it, expect } from 'vitest';
import type { MatchmakingData } from '../src/lib/matchmaking.js';
import { generateSingleElim } from '../src/lib/bracket.js';
import {
  seedFactionWarOrder,
  evaluateFirstGameCost,
  type SeedableFormat,
} from '../src/lib/faction-war-seeding.js';

// --- fake rating data -------------------------------------------------------

const pairKey = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);

/** A MatchmakingData whose faction tilt (log-odds) comes from `tiltMag`, anti-symmetric in x,y. */
function fakeData(
  tiltMag: (a: string, b: string) => number,
  played: (a: string, b: string) => boolean = () => true,
): MatchmakingData {
  return {
    skillOf: () => 0,
    factionTilt: (x, y) => {
      if (x === y) return { tilt: 0, hasData: false };
      const mag = tiltMag(x < y ? x : y, x < y ? y : x);
      return { tilt: x < y ? mag : -mag, hasData: played(x, y) };
    },
  };
}

/** Each player pi gets a distinct faction fi (Faction War guarantees distinct factions). */
function distinctFactions(n: number): { ids: string[]; factionById: Map<string, string | null> } {
  const ids = Array.from({ length: n }, (_, i) => `p${i}`);
  const factionById = new Map(ids.map((id, i) => [id, `f${i}`]));
  return { ids, factionById };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 1000;
}

const SIZES: number[] = [8, 16, 24, 32];

describe('Faction War bracket seeding', () => {
  it('is a permutation of the input and deterministic', () => {
    const data = fakeData((a, b) => (hash(pairKey(a, b)) - 500) / 150);
    for (const n of SIZES) {
      const { ids, factionById } = distinctFactions(n);
      const out1 = seedFactionWarOrder('t', ids, factionById, data, 'SINGLE_ELIMINATION');
      const out2 = seedFactionWarOrder('t', ids, factionById, data, 'SINGLE_ELIMINATION');
      expect([...out1].sort()).toEqual([...ids].sort()); // same multiset
      expect(out2).toEqual(out1); // deterministic
    }
  });

  it('never seeds a worse bracket than the input order (SE and DE, incl. byes)', () => {
    const data = fakeData((a, b) => (hash(pairKey(a, b)) - 500) / 150);
    for (const format of ['SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION'] as SeedableFormat[]) {
      for (const n of SIZES) {
        const { ids, factionById } = distinctFactions(n);
        const seeded = seedFactionWarOrder('t', ids, factionById, data, format);
        const before = evaluateFirstGameCost('t', ids, factionById, data, format);
        const after = evaluateFirstGameCost('t', seeded, factionById, data, format);
        expect(after).toBeLessThanOrEqual(before + 1e-9);
      }
    }
  });

  it('pairs the fair faction matchups in round 1 (crafted 4-player optimum)', () => {
    // A–B and C–D are coin-flips; every cross pairing is crushing.
    const TILT: Record<string, number> = {
      'A|B': 0,
      'C|D': 0,
      'A|C': 4,
      'A|D': 4,
      'B|C': 4,
      'B|D': 4,
    };
    const data = fakeData((a, b) => TILT[pairKey(a, b)] ?? 0);
    const ids = ['p0', 'p1', 'p2', 'p3'];
    const facById = new Map<string, string | null>([
      ['p0', 'A'],
      ['p1', 'B'],
      ['p2', 'C'],
      ['p3', 'D'],
    ]);
    const order = seedFactionWarOrder('t', ids, facById, data, 'SINGLE_ELIMINATION');

    const facOf = (id: string) => facById.get(id)!;
    const r1 = generateSingleElim('t', order)
      .filter((m) => m.round === 1 && m.player1_id && m.player2_id)
      .map((m) => [facOf(m.player1_id!), facOf(m.player2_id!)].sort().join('-'))
      .sort();
    // The only fair round-1 pairing of {A,B,C,D} is A-B and C-D.
    expect(r1).toEqual(['A-B', 'C-D']);
  });

  it('degrades gracefully with missing factions and never-played pairs', () => {
    const data = fakeData(() => 0, () => false); // no game history anywhere
    const n = 24;
    const { ids } = distinctFactions(n);
    const factionById = new Map<string, string | null>(
      ids.map((id, i) => [id, i % 4 === 0 ? null : `f${i}`]), // some players have no faction
    );
    const out = seedFactionWarOrder('t', ids, factionById, data, 'SINGLE_ELIMINATION');
    expect([...out].sort()).toEqual([...ids].sort());
    expect(out).toHaveLength(n);
  });
});
