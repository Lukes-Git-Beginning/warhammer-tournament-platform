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
//  - Pair the earliest COMPATIBLE opponent, not merely the earliest available: a
//    cross-band jump of two or more bands is DEFERRED while a strictly-closer
//    opponent is still due to arrive in this pool (finishing the previous round).
//    Two New players who just met wait for a Beginner to free up instead of being
//    shoved three bands into the lone Advanced player. The hold resolves over the
//    next ticks as the pool fills; a big jump only happens once nothing closer can
//    still arrive.
//  - Rematch vs. play-up is a cost trade-off: the immediately-previous opponent is
//    excluded outright, but an EVENTUAL rematch (a repeat from an earlier round) is
//    allowed at a cost of ~1.5 bands — a fresh one-band play-up beats a repeat, while
//    a repeat beats a jump of two or more bands. This stops a tiny band (e.g. two New
//    players) from cycling the same matchup every other round.
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
  /** Opponent of the highest-round played match (the immediate-rematch hard block). */
  lastOpponentId: string | null;
  /** Every opponent this player has faced (drives the soft eventual-rematch penalty). */
  pastOpponents: Set<string>;
  lastPlayedRound: number;
}

/** A player currently waiting to be paired, tagged for the pairing algorithm. */
interface Waiter {
  userId: string;
  band: number;
  lastOpponentId: string | null;
  pastOpponents: Set<string>;
}

/** How many bands of play-up an EVENTUAL rematch — a repeat of an opponent from an
 *  earlier, non-consecutive round — is considered "worth". At 1.5 a player prefers a
 *  fresh opponent one band up over replaying someone, but prefers replaying over a
 *  jump of two or more bands. The immediately-previous opponent is never a candidate
 *  at all (strict no-immediate-rematch). Alex-Spec 2026-07-03. */
export const EVENTUAL_REMATCH_COST = 1.5;

/** True when a and b faced each other in the round each just finished (hard block). */
function isImmediateRematch(a: Waiter, b: Waiter): boolean {
  return a.lastOpponentId === b.userId || b.lastOpponentId === a.userId;
}

/** True when a and b have ever met — drives the soft eventual-rematch penalty. */
function metBefore(a: Waiter, b: Waiter): boolean {
  return a.pastOpponents.has(b.userId) || b.pastOpponents.has(a.userId);
}

/**
 * Pair one round pool by minimum cost, where a pairing's cost is the band distance
 * plus a penalty (EVENTUAL_REMATCH_COST) when the two have met before. That weighs
 * the two soft constraints — repeating an opponent vs. playing up a band:
 *   same band, fresh   0        1 band up, fresh   1
 *   eventual rematch   1.5      2 bands up, fresh  2 …
 * so a fresh one-band play-up beats a repeat, but a repeat beats a >=2-band jump.
 * The immediately-previous opponent is excluded outright (strict no-rematch).
 *
 * A candidate pairing is DEFERRED while either player could still get a strictly
 * cheaper one from a player finishing the previous round and joining this pool
 * (`incomingBands`) — the pool pairs the earliest COMPATIBLE player, not the earliest.
 * A lone straggler holds while anyone is still incoming; otherwise the lowest band byes.
 */
function pairPool(
  waiting: Waiter[],
  incomingBands: number[],
): { pairs: [Waiter, Waiter][]; byes: Waiter[] } {
  const cost = (a: Waiter, b: Waiter): number =>
    Math.abs(a.band - b.band) + (metBefore(a, b) ? EVENTUAL_REMATCH_COST : 0);

  // Cheapest pairing either player could still get from an incoming opponent. An
  // incoming player already finished this pool's round, so it is never an immediate
  // rematch and (bar a rarer eventual rematch) fresh → approximate by band gap only.
  const incBest = (band: number): number =>
    incomingBands.length === 0
      ? Infinity
      : Math.min(...incomingBands.map((ib) => Math.abs(ib - band)));

  // All eligible pairs (immediate rematch excluded), cheapest first.
  const candidates: Array<{ i: number; j: number; c: number }> = [];
  for (let i = 0; i < waiting.length; i++) {
    for (let j = i + 1; j < waiting.length; j++) {
      if (isImmediateRematch(waiting[i]!, waiting[j]!)) continue;
      candidates.push({ i, j, c: cost(waiting[i]!, waiting[j]!) });
    }
  }
  // Cheapest first; tie-break by lower band so the weaker surplus is placed first.
  candidates.sort((a, b) => a.c - b.c || waiting[a.i]!.band - waiting[b.i]!.band);

  const pairs: [Waiter, Waiter][] = [];
  const used = new Set<number>();
  for (const { i, j, c } of candidates) {
    if (used.has(i) || used.has(j)) continue;
    if (incBest(waiting[i]!.band) < c || incBest(waiting[j]!.band) < c) {
      continue; // a strictly cheaper opponent is still on the way → wait for them
    }
    used.add(i);
    used.add(j);
    pairs.push([waiting[i]!, waiting[j]!]);
  }

  const stuck = waiting.filter((_, i) => !used.has(i));

  // Whatever remains: hold if reinforcements are still coming (a cheaper partner may
  // yet arrive), else the lowest-band straggler takes the bye (Swiss odd-out).
  const byes: Waiter[] = [];
  if (stuck.length > 0 && incomingBands.length === 0) {
    stuck.sort((a, b) => a.band - b.band);
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
        pastOpponents: new Set<string>(),
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
        if (opp && roster.has(opp)) pr.pastOpponents.add(opp);
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
  const incomingByRound = new Map<number, number[]>(); // pool round → bands still arriving
  for (const pr of progress.values()) {
    if (pr.activeRound !== null) {
      // Currently playing round `activeRound` → will join pool activeRound+1 next.
      const next = pr.activeRound + 1;
      if (next <= roundsCount) {
        const arr = incomingByRound.get(next) ?? [];
        arr.push(pr.band);
        incomingByRound.set(next, arr);
      }
      continue;
    }
    if (pr.completed >= roundsCount) continue; // done — no more pairing
    const round = pr.completed + 1;
    const list = waitingByRound.get(round) ?? [];
    list.push({
      userId: pr.userId,
      band: pr.band,
      lastOpponentId: pr.lastOpponentId,
      pastOpponents: pr.pastOpponents,
    });
    waitingByRound.set(round, list);
  }

  const pairings: PlannedPairing[] = [];
  const byes: PlannedBye[] = [];
  for (const [round, waiting] of waitingByRound) {
    const { pairs, byes: poolByes } = pairPool(waiting, incomingByRound.get(round) ?? []);
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
