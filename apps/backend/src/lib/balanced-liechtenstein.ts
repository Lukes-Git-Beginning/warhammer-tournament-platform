// ---------------------------------------------------------------------------
// Balanced Liechtenstein — skill-balanced, incrementally-paired Swiss format.
//
// A Swiss-structured tournament (N rounds, wins + Buchholz standings) whose
// pairings are driven by SKILL (division band) instead of points, and whose
// rounds after the first are generated MATCH BY MATCH as players finish, rather
// than in one batch. A fast player can already be in round 3 while others are
// still in round 1 — but two players only ever meet at the same round depth
// (both have k-1 games behind them), so the round number stays consistent and
// the final view looks like a normal Swiss/Liechtenstein bracket.
//
// This module is PURE + synchronous: given the current participants (with skill
// bands) and match rows, `planPairings()` returns the matches to create right
// now (and any byes). The DB/Redis side lives in balanced-liechtenstein-service.
//
// Pairing rules (Alex-Spec):
//  - Pair within the skill band; the surplus ascends (weaker player takes the
//    up-play, never a stronger one reaching down to stomp) → process from below,
//    smallest skill distance first.
//  - Only the immediately-previous opponent is excluded (no full rematch-free
//    guarantee) — small fields alternate cleanly (B, C, B, C …).
//  - Pairing happens WITHIN a round pool only (both players at k-1 games).
// ---------------------------------------------------------------------------

/** Default division when a participant has no skill_band yet (Intermediate). */
export const DEFAULT_BAND = 3;

/** Terminal statuses that count as a played round toward a player's progress. */
const ADVANCING = new Set(['COMPLETED', 'BYE', 'FORFEIT', 'NO_CONTEST']);
/** Non-terminal statuses: the player is assigned/playing, not waiting for a new match. */
const ACTIVE = new Set(['PENDING', 'ONGOING', 'AWAITING_CONFIRMATION', 'DISPUTED']);

export interface BalancedParticipant {
  userId: string;
  /** Skill division 1..5 (matchmakingBand). Falls back to DEFAULT_BAND when null. */
  band: number | null;
}

export interface BalancedMatchRow {
  round: number;
  player1_id: string | null;
  player2_id: string | null;
  status: string;
}

export interface PlannedPairing {
  round: number;
  player1_id: string;
  player2_id: string;
}

export interface PlannedBye {
  round: number;
  player_id: string;
}

export interface PairingPlan {
  pairings: PlannedPairing[];
  byes: PlannedBye[];
  /** True when every active participant has played all `roundsCount` rounds. */
  complete: boolean;
}

interface Progress {
  userId: string;
  band: number;
  /** Number of played (advancing) matches. */
  completed: number;
  /** Round of the current non-terminal match, or null when idle/waiting. */
  activeRound: number | null;
  /** Opponent of the highest-round played match (for immediate-rematch exclusion). */
  lastOpponentId: string | null;
  lastPlayedRound: number;
}

/** A player currently waiting to be paired, tagged for the pairing algorithm. */
interface Waiter {
  userId: string;
  band: number;
  lastOpponentId: string | null;
}

function isRematch(a: Waiter, b: Waiter): boolean {
  return a.lastOpponentId === b.userId || b.lastOpponentId === a.userId;
}

/**
 * Greedily pair a candidate list. For same-band pairing pass the band group; for
 * the cross-band fallback pass the leftovers sorted by band ascending, so the
 * first non-rematch partner found is always the nearest higher band (the weaker
 * player ascends). Returns the pairs plus whoever could not be paired.
 */
function greedyPair(candidates: Waiter[]): { pairs: [Waiter, Waiter][]; leftovers: Waiter[] } {
  const used = new Set<number>();
  const pairs: [Waiter, Waiter][] = [];
  for (let i = 0; i < candidates.length; i++) {
    if (used.has(i)) continue;
    for (let j = i + 1; j < candidates.length; j++) {
      if (used.has(j)) continue;
      if (!isRematch(candidates[i]!, candidates[j]!)) {
        used.add(i);
        used.add(j);
        pairs.push([candidates[i]!, candidates[j]!]);
        break;
      }
    }
  }
  const leftovers = candidates.filter((_, i) => !used.has(i));
  return { pairs, leftovers };
}

/**
 * Pair one round pool. Same-band first (from below), then a cross-band ascending
 * fallback for the surplus. A lone leftover waits when more players are still due
 * to arrive in this pool (`hasIncoming`); otherwise it takes a bye.
 */
function pairPool(
  waiting: Waiter[],
  hasIncoming: boolean,
): { pairs: [Waiter, Waiter][]; byes: Waiter[] } {
  const pairs: [Waiter, Waiter][] = [];

  // Pass 1 — within-band, lowest band first.
  const byBand = new Map<number, Waiter[]>();
  for (const w of waiting) {
    const g = byBand.get(w.band) ?? [];
    g.push(w);
    byBand.set(w.band, g);
  }
  const leftovers: Waiter[] = [];
  for (const band of [...byBand.keys()].sort((a, b) => a - b)) {
    const { pairs: p, leftovers: l } = greedyPair(byBand.get(band)!);
    pairs.push(...p);
    leftovers.push(...l);
  }

  // Pass 2 — cross-band ascending fallback for the surplus.
  leftovers.sort((a, b) => a.band - b.band);
  const { pairs: crossPairs, leftovers: stuck } = greedyPair(leftovers);
  pairs.push(...crossPairs);

  // Whatever remains: hold if reinforcements are coming, else bye (Swiss odd-out).
  const byes: Waiter[] = [];
  if (stuck.length > 0 && !hasIncoming) {
    // No one else will join this pool → the lowest-band straggler takes a bye.
    // (A rematch-locked pair with no incoming resolves over successive ticks.)
    byes.push(stuck[0]!);
  }
  return { pairs, byes };
}

/**
 * Compute the pairings (and byes) that should be created right now for a Balanced
 * Liechtenstein tournament, from its participants and current match rows. Pure.
 *
 * Called both at start (no matches yet → pairs the whole of round 1) and after
 * every match completion (pairs the freed players into their next round).
 */
export function planPairings(
  participants: BalancedParticipant[],
  matches: BalancedMatchRow[],
  roundsCount: number,
): PairingPlan {
  const roster = new Set(participants.map((p) => p.userId));
  const bandOf = new Map(participants.map((p) => [p.userId, p.band ?? DEFAULT_BAND]));

  const progress = new Map<string, Progress>();
  const ensure = (userId: string): Progress => {
    let pr = progress.get(userId);
    if (!pr) {
      pr = {
        userId,
        band: bandOf.get(userId) ?? DEFAULT_BAND,
        completed: 0,
        activeRound: null,
        lastOpponentId: null,
        lastPlayedRound: 0,
      };
      progress.set(userId, pr);
    }
    return pr;
  };
  // Seed every active participant so those without any match land in pool 1.
  for (const p of participants) ensure(p.userId);

  for (const m of matches) {
    const sides: Array<{ me: string | null; opp: string | null }> = [
      { me: m.player1_id, opp: m.player2_id },
      { me: m.player2_id, opp: m.player1_id },
    ];
    for (const { me, opp } of sides) {
      if (!me || !roster.has(me)) continue;
      const pr = ensure(me);
      if (ADVANCING.has(m.status)) {
        pr.completed += 1;
        if (m.round >= pr.lastPlayedRound) {
          pr.lastPlayedRound = m.round;
          pr.lastOpponentId = opp && roster.has(opp) ? opp : null;
        }
      } else if (ACTIVE.has(m.status)) {
        pr.activeRound = m.round;
      }
      // CANCELLED / voided statuses are ignored (the round will be re-paired).
    }
  }

  // Bucket players by the round pool they are waiting for / incoming to.
  const waitingByRound = new Map<number, Waiter[]>();
  const incomingByRound = new Map<number, number>();
  for (const pr of progress.values()) {
    if (pr.activeRound !== null) {
      // Currently playing round `activeRound` → will join pool activeRound+1 next.
      const next = pr.activeRound + 1;
      if (next <= roundsCount) incomingByRound.set(next, (incomingByRound.get(next) ?? 0) + 1);
      continue;
    }
    if (pr.completed >= roundsCount) continue; // done — no more pairing
    const round = pr.completed + 1;
    const list = waitingByRound.get(round) ?? [];
    list.push({ userId: pr.userId, band: pr.band, lastOpponentId: pr.lastOpponentId });
    waitingByRound.set(round, list);
  }

  const pairings: PlannedPairing[] = [];
  const byes: PlannedBye[] = [];
  for (const [round, waiting] of waitingByRound) {
    const { pairs, byes: poolByes } = pairPool(waiting, (incomingByRound.get(round) ?? 0) > 0);
    for (const [a, b] of pairs) {
      pairings.push({ round, player1_id: a.userId, player2_id: b.userId });
    }
    for (const w of poolByes) byes.push({ round, player_id: w.userId });
  }

  const complete = [...progress.values()].every(
    (pr) => pr.completed >= roundsCount && pr.activeRound === null,
  );

  return { pairings, byes, complete };
}

// ---------------------------------------------------------------------------
// Division playoffs (Alex-Spec §7)
//
// Because balanced pairing makes every game ~50/50, a record carries no absolute
// skill info (a 5-0 in level 2 == a 5-0 in level 4) — so there is NO shared
// playoff. Instead each skill level gets its own division; the top 2 of each
// division play a final for that level's champion.
//
// Pools are formed from the TOP, player by player: a level keeps all its own
// players, and a level with fewer than 4 borrows the best players of the level(s)
// below until it reaches 4 (the borrowed player is promoted out of their level).
// A trailing bottom pool that still can't reach 4 is merged into the pool above.
// ---------------------------------------------------------------------------

/** Minimum players a division pool needs before it stands on its own. */
export const MIN_POOL_SIZE = 4;

export interface RankedPlayer {
  userId: string;
  band: number;
  /** Final Swiss placement, 1 = best. Drives pool fill order + finalist choice. */
  rank: number;
}

export interface DivisionPool {
  /** The level this pool belongs to (its own players' band). */
  band: number;
  /** Members, best rank first. Includes any players promoted from below. */
  players: RankedPlayer[];
  /** The two best-ranked members who play the division final (null if < 2). */
  finalists: [string, string] | null;
}

/**
 * Group ranked players into division pools of at least MIN_POOL_SIZE, top down,
 * borrowing the best of the levels below to fill short levels. Pure.
 */
export function formDivisionPools(players: RankedPlayer[]): DivisionPool[] {
  // Best of the highest level first; within a level, best rank first.
  const ordered = [...players].sort((a, b) => b.band - a.band || a.rank - b.rank);
  const assigned = new Set<string>();
  const bandsDesc = [...new Set(ordered.map((p) => p.band))].sort((a, b) => b - a);

  const pools: DivisionPool[] = [];
  for (const band of bandsDesc) {
    const own = ordered.filter((p) => p.band === band && !assigned.has(p.userId));
    if (own.length === 0) continue;
    const members = [...own];
    own.forEach((p) => assigned.add(p.userId));

    // Borrow the best available players from the levels below to reach the minimum.
    if (members.length < MIN_POOL_SIZE) {
      for (const c of ordered) {
        if (members.length >= MIN_POOL_SIZE) break;
        if (c.band < band && !assigned.has(c.userId)) {
          members.push(c);
          assigned.add(c.userId);
        }
      }
    }
    pools.push({ band, players: members, finalists: null });
  }

  // A trailing pool that never reached the minimum joins the pool above it.
  if (pools.length >= 2 && pools[pools.length - 1]!.players.length < MIN_POOL_SIZE) {
    const last = pools.pop()!;
    pools[pools.length - 1]!.players.push(...last.players);
  }

  // Top 2 of each pool (by rank) contest the division final.
  for (const pool of pools) {
    pool.players.sort((a, b) => a.rank - b.rank);
    pool.finalists =
      pool.players.length >= 2 ? [pool.players[0]!.userId, pool.players[1]!.userId] : null;
  }

  return pools;
}
