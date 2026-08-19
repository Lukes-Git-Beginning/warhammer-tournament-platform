// Balanced Liechtenstein — frozen playoff plan (2026-08-09). See plans/bali-playoff-plan-freeze.md.
//
// Once the FIRST division's playoff is generated, the STRUCTURE of the whole playoff is frozen so a
// later drop can't re-merge / re-count divisions (which strands players when a shrunk lower division
// would fold into an already-generated upper one). We freeze only the skeleton — how many divisions,
// each one's band anchor, target size and per-band draw counts — NOT the concrete members (a borrowed
// player's identity, e.g. "the top 3 of Advanced", is only known after that band's last round). Members
// resolve live from the current standings per the frozen skeleton; shortfalls borrow from neighbour
// bands. Pure module — no DB, unit-tested.

import { cappedDivisionPlayoffFormat, type RankedPlayer, type DivisionPool } from './balanced-liechtenstein.js';
import { adjustedSeedScore } from './bali-playoff-seeding.js';

/** One frozen division: its band anchor, target pool size, and how many players it draws per band. */
export interface PlanDivision {
  /** 0 = the top division. Fixes the top-down order. */
  ordinal: number;
  /** The division's own (highest) band — drives the cross-band seeding handicap. */
  anchorBand: number;
  /** Frozen pool size at first generation — the borrow target (actual size may fall short after drops). */
  targetSize: number;
  /** How many players to take per band, own band (= anchor) first, then borrowed bands, band desc. */
  draws: { band: number; count: number }[];
}

/** The frozen structural skeleton of a tournament's division playoffs. */
export interface PlayoffPlan {
  divisions: PlanDivision[];
}

/**
 * Freeze the skeleton from a formDivisionPools result computed at first generation. Records only the
 * structure (band anchors, target sizes, per-band draw counts) — never the concrete members.
 */
export function derivePlayoffPlan(pools: DivisionPool[]): PlayoffPlan {
  const divisions = pools.map((pool, ordinal): PlanDivision => {
    const byBand = new Map<number, number>();
    for (const p of pool.players) byBand.set(p.band, (byBand.get(p.band) ?? 0) + 1);
    const draws = [...byBand.entries()]
      .sort((a, b) => b[0] - a[0]) // band desc → own (anchor) band first, then borrowed
      .map(([band, count]) => ({ band, count }));
    return { ordinal, anchorBand: pool.band, targetSize: pool.players.length, draws };
  });
  return { divisions };
}

/** Seed comparator for a given division anchor: handicap-adjusted score desc, then Swiss rank. */
function bySeed(anchorBand: number, rounds: number) {
  return (a: RankedPlayer, b: RankedPlayer): number =>
    adjustedSeedScore(b.rawScore, rounds, anchorBand, b.band) -
      adjustedSeedScore(a.rawScore, rounds, anchorBand, a.band) ||
    a.rank - b.rank;
}

/**
 * Resolve a frozen division's POOL members from the current field. Fills each band's draw count with
 * the best available (handicap-seeded) players, then covers any shortfall from neighbour bands — the
 * TOP of the nearest LOWER band first (the "just-missed"), then the BOTTOM of the nearest HIGHER band.
 * Includes 0-point players (they count toward pool size / format); the bracket-seat filter is separate
 * (see bracketSeeds). `claimed` = players already placed in a higher, already-generated division.
 */
export function resolveDivisionPool(
  div: PlanDivision,
  field: RankedPlayer[],
  rounds: number,
  claimed: Set<string> = new Set(),
): RankedPlayer[] {
  const cmp = bySeed(div.anchorBand, rounds);
  const byBand = new Map<number, RankedPlayer[]>();
  for (const p of field) {
    if (claimed.has(p.userId)) continue;
    const list = byBand.get(p.band) ?? [];
    list.push(p);
    byBand.set(p.band, list);
  }
  for (const list of byBand.values()) list.sort(cmp);

  const picked: RankedPlayer[] = [];
  const taken = new Set<string>();
  const take = (p: RankedPlayer) => {
    picked.push(p);
    taken.add(p.userId);
  };

  // 1) Fill the frozen per-band draws (best-first within each band).
  for (const draw of div.draws) {
    const avail = (byBand.get(draw.band) ?? []).filter((p) => !taken.has(p.userId));
    for (const p of avail.slice(0, draw.count)) take(p);
  }

  // 2) Shortfall → neighbour-bench borrow. Lower bands first (their TOP players), then higher bands
  //    (their BOTTOM players). Nearest band first in each direction.
  let shortfall = div.targetSize - picked.length;
  const remaining = (band: number, fromBottom: boolean): RankedPlayer[] => {
    const list = (byBand.get(band) ?? []).filter((p) => !taken.has(p.userId));
    return fromBottom ? list.slice().reverse() : list;
  };
  if (shortfall > 0) {
    const lower = [...byBand.keys()].filter((b) => b < div.anchorBand).sort((a, b) => b - a); // nearest below first
    for (const b of lower) {
      for (const p of remaining(b, false)) {
        if (shortfall <= 0) break;
        take(p);
        shortfall--;
      }
      if (shortfall <= 0) break;
    }
  }
  if (shortfall > 0) {
    const higher = [...byBand.keys()].filter((b) => b > div.anchorBand).sort((a, b) => a - b); // nearest above first
    for (const b of higher) {
      for (const p of remaining(b, true)) {
        if (shortfall <= 0) break;
        take(p);
        shortfall--;
      }
      if (shortfall <= 0) break;
    }
  }

  return picked.sort(cmp);
}

/**
 * Bracket seed order for a resolved division pool: seat-eligible players (organic Swiss score > 0)
 * in seed order first, then 0-point players. A 0-point player counts toward the pool size (so the
 * format is unchanged) but is demoted below every earner, so they only ever occupy a bracket seat
 * when there are too few earners to fill it (a degenerate, non-practical case). The handicap is NOT a
 * seat gate: an earner driven to <= 0 by the cross-band handicap stays ahead of every 0-point player.
 */
export function bracketSeeds(pool: RankedPlayer[]): string[] {
  const earners = pool.filter((p) => p.rawScore > 0);
  const zeros = pool.filter((p) => p.rawScore <= 0);
  return [...earners, ...zeros].map((p) => p.userId);
}

/** The bracket format a resolved pool yields (mirrors the live path: size capped by host format). */
export function planDivisionFormat(
  pool: RankedPlayer[],
  hostFormat: string | null | undefined,
): 'TOP2' | 'TOP4' | 'TOP8' {
  return cappedDivisionPlayoffFormat(pool.length, hostFormat);
}

/** A division resolved from the frozen plan against the current field: anchor + members + seed order. */
export interface ResolvedDivision {
  band: number;
  players: RankedPlayer[];
  seeds: string[];
}

/**
 * Resolve every division from the frozen plan against the current field, top division first. Each
 * division claims its resolved members so lower divisions draw from what remains — so a shortfall in
 * an upper division borrows down and the shrinkage **cascades to the bottom** division rather than
 * re-merging or stranding anyone. The division count and band anchors stay fixed (the plan), only the
 * membership flexes. Already-generated divisions reproduce their members (their bands are settled), so
 * the caller's existing "already in playoff → skip" guard still recognises them.
 */
export function resolvePoolsFromPlan(
  plan: PlayoffPlan,
  field: RankedPlayer[],
  rounds: number,
): ResolvedDivision[] {
  const claimed = new Set<string>();
  const out: ResolvedDivision[] = [];
  for (const div of plan.divisions) {
    const pool = resolveDivisionPool(div, field, rounds, claimed);
    for (const p of pool) claimed.add(p.userId);
    out.push({ band: div.anchorBand, players: pool, seeds: bracketSeeds(pool) });
  }
  return out;
}
