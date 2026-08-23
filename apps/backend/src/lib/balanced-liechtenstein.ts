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

import blossom from 'edmonds-blossom';
import { pairCost, bandGapCost } from './bali-pairing-cost.js';
import { adjustedSeedScore } from './bali-playoff-seeding.js';

/** Default division when a participant has no skill_band yet (Intermediate). */
export const DEFAULT_BAND = 3;

// BaLi 2.0 pairing-engine tuning (the progressive cost itself lives in bali-pairing-cost.ts).
/** Integer scale for the float progressive costs so Blossom stays exact (1.3 → 13000).
 *  Large enough that the tie-break bonuses below never override a real cost gap (the
 *  smallest, 0.2, scales to 2000 — far above any achievable bonus sum). */
const COST_SCALE = 10_000;
/** Max band value, for the protect-the-weak tie-break below. */
export const MAX_BAND = 5;
/** Per-band weight of the "protect the weak" tie-break (must dominate the +1 commit
 *  nudge, and its per-matching sum must stay far below the 2000 cost granularity — true
 *  for realistic same-depth pools). */
const PROTECT_WEIGHT = 2;
/** Max-weight tie-break bonus for a real edge that involves at least one FREE player,
 *  added on top of the min-cost weight so that among EQUAL-COST optima Blossom:
 *   (a) prefers pairing/RESERVING the LOWER band first — including holding a free player
 *       for an incoming low one — which fixes the uniform-Δ1 trap where the optimiser is
 *       indifferent between b1–b2 and b2–b3 and keeps passing a lone weak player over
 *       until only a far band is left (a Δ3/Δ4 stomp), and
 *   (b) all else equal, COMMITS two free players rather than holding (the +1).
 *  A real cost difference always dominates (the bonus never crosses the cost granularity).
 *  Incoming↔incoming edges get nothing (not actionable now). */
const edgeBonus = (lowFree: boolean, highFree: boolean, bandA: number, bandB: number): number =>
  lowFree || highFree ? PROTECT_WEIGHT * (MAX_BAND + 1 - Math.min(bandA, bandB)) + (lowFree && highFree ? 1 : 0) : 0;
/** Closed-pool last-resort penalty ADDED to the band gap so that an immediate rematch is
 *  only ever chosen when there is literally no fresh partner left (nobody incoming) — a
 *  fresh play-up of ANY size (max band gap cost 9) is preferred over replaying a just-met
 *  opponent, but replaying still beats double-byeing two locked leftovers (#3). Never used
 *  while the pool is still open (there an immediate rematch has no edge at all → hold). */
const IMMEDIATE_LAST_RESORT = 1_000;
/** Force-match weight for a player who may NOT take a bye (already rested — never-bye-twice).
 *  The max-weight matching otherwise leaves the highest-cost node (a lone top-band player)
 *  unmatched as a bye — but if they already byed, the rule forbids that and they get stomped
 *  at a far band instead (the R4 "knife" case). Adding this to EVERY edge touching such a
 *  player makes the matching always pair them; it is constant across their edges, so it forces
 *  matching WITHOUT distorting which partner (the blossom still picks their min-cost one). It
 *  dwarfs any real cost/bonus so a can't-bye player is never the leftover unless everyone is. */
const MUST_PAIR_BONUS = 100_000_000;

/** Terminal statuses that count as a played round toward a player's progress. A
 *  PENDING_BYE advances the holder too (so the tournament flows), but stays reclaimable
 *  into a real match until the holder is paired forward — see the tick's reclaim pass. */
const ADVANCING = new Set(['COMPLETED', 'BYE', 'FORFEIT', 'NO_CONTEST', 'CATCHUP_BYE', 'PENDING_BYE']);
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

/** Deterministic PRNG shuffle (mulberry32) seeded from a string — reproducible
 *  tie-breaks when several equal-cost pairings exist (mirrors swiss.ts). */
export function seededShuffle<T>(arr: T[], seed: string): T[] {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  const rand = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** True when a and b faced each other in the round each just finished (hard block). */
function isImmediateRematch(a: Waiter, b: Waiter): boolean {
  return a.lastOpponentId === b.userId || b.lastOpponentId === a.userId;
}

/** True when a and b have ever met — drives the soft eventual-rematch penalty. */
function metBefore(a: Waiter, b: Waiter): boolean {
  return a.pastOpponents.has(b.userId) || b.pastOpponents.has(a.userId);
}

/**
 * Pair one round pool under BaLi 2.0's "provisional optimum, commit-when-free" model.
 *
 * The pool's FULL field is modelled at once: the FREE players waiting now (`waiting`)
 * plus the INCOMING players still finishing the previous round (`incoming`). A single
 * global minimum-cost matching (Edmonds' Blossom over the progressive `pairCost`) is
 * computed across the whole field, and only edges between two FREE players are COMMITTED
 * now. A free player whose optimal partner is still incoming is HELD (no match), to be
 * re-evaluated on the next tick once that partner frees up — because committing any edge
 * that lies in some min-cost matching provably preserves the global optimum. This is what
 * kills the greedy-in-time stomps: a close-band partner who is still playing is "reserved"
 * by the matching, never pre-empted by an eager pairing that later forces a big band jump.
 *
 * Costs (bali-pairing-cost.ts) are progressive + asymmetric: every Δ1 is cheap and uniform
 * (< a rematch), gaps ≥ 2 are asymmetric so a low player is not stomped. A tie-break bonus
 * protects the weakest — among EQUAL-cost optima it pairs/reserves the lowest band first,
 * so the uniform Δ1 costs cannot strand a lone low player.
 *
 * Byes are AVOIDED (Alex): a forced big band gap is PLAYED, never turned into a bye. While
 * anyone is still incoming, an unmatched free player HOLDS (no bye). Only once the pool is
 * CLOSED (nobody incoming) does the last free player with no partner take a bye — the one
 * genuinely unavoidable, odd-count case. An immediate rematch is forbidden while the pool
 * is open (the player holds); in a closed pool it is allowed only as an absolute last
 * resort (a heavy penalty, so any fresh play-up wins) to avoid double-byeing two locked
 * leftovers (#3).
 */
function pairPool(
  waiting: Waiter[],
  incoming: Waiter[],
  seedKey: string,
  pickBye?: (candidateUserIds: string[]) => string[],
  // Players who may NOT take a bye (already rested — never-bye-twice). They are force-matched so
  // the incremental matching never reserves them a bye it will later forbid (→ far-band stomp).
  noBye?: Set<string>,
): { pairs: [Waiter, Waiter][]; byes: Waiter[] } {
  // Order by id then seeded-shuffle → the pool's output depends only on the SET of
  // players (+ seed), not on the DB row order, and equal-cost optima are reproducible.
  const byId = (a: Waiter, b: Waiter): number =>
    a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
  const free = seededShuffle([...waiting].sort(byId), `${seedKey}:free`);
  const inc = seededShuffle([...incoming].sort(byId), `${seedKey}:inc`);
  const closed = inc.length === 0; // no reinforcements → this pool is final

  // Scaled cost of an edge, or null when it must not exist. An immediate rematch has no
  // edge while the pool is still open (the players hold for a fresh partner); in a closed
  // pool it becomes a heavy last-resort cost so a fresh play-up of any size still wins.
  const edgeScaled = (a: Waiter, b: Waiter): number | null => {
    if (isImmediateRematch(a, b)) {
      return closed
        ? Math.round((bandGapCost(a.band, b.band) + IMMEDIATE_LAST_RESORT) * COST_SCALE)
        : null;
    }
    const c = pairCost(a.band, b.band, { immediate: false, metBefore: metBefore(a, b) });
    return Number.isFinite(c) ? Math.round(c * COST_SCALE) : null;
  };

  // Min-cost matching over `freeList` (+ the shared incoming pool). Returns the committed
  // FREE↔FREE pairs and, once the pool is closed, the unmatched leftover as byes. A free player
  // matched to an incoming node is HELD (their optimal partner is still playing).
  const solve = (freeList: Waiter[]): { pairs: [Waiter, Waiter][]; byes: Waiter[] } => {
    const pairs: [Waiter, Waiter][] = [];
    const byes: Waiter[] = [];
    const W = freeList.length;
    const nodes = [...freeList, ...inc]; // [free | incoming]
    const n = nodes.length;
    const isFree = (i: number): boolean => i < W;
    const mate = new Array<number>(n).fill(-1);
    if (n >= 2) {
      let maxScaled = 0;
      for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++) {
          const s = edgeScaled(nodes[i]!, nodes[j]!);
          if (s !== null && s > maxScaled) maxScaled = s;
        }
      const K = maxScaled + 1; // offset so max-weight matching == min-cost matching
      const edges: Array<[number, number, number]> = [];
      for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++) {
          const s = edgeScaled(nodes[i]!, nodes[j]!);
          if (s === null) continue;
          const mustPair =
            noBye && (noBye.has(nodes[i]!.userId) || noBye.has(nodes[j]!.userId)) ? MUST_PAIR_BONUS : 0;
          const bonus = edgeBonus(isFree(i), isFree(j), nodes[i]!.band, nodes[j]!.band) + mustPair;
          edges.push([i, j, K - s + bonus]);
        }
      if (edges.length > 0) {
        const result = blossom(edges);
        for (let i = 0; i < n; i++) mate[i] = result[i] ?? -1;
      }
    }
    for (let i = 0; i < W; i++) {
      const j = mate[i]!;
      if (j < 0) {
        if (closed) byes.push(nodes[i]!);
        continue;
      }
      if (isFree(j) && j > i) pairs.push([nodes[i]!, nodes[j]!]);
      // matched to an incoming node → hold (no row)
    }
    return { pairs, byes };
  };

  // Play-up profile of a matching: (worst band-gap, #gaps≥2, total gap). Lower is better.
  const profile = (m: { pairs: [Waiter, Waiter][] }): [number, number, number] => {
    let worst = 0, heavy = 0, total = 0;
    for (const [a, b] of m.pairs) {
      const g = Math.abs(a.band - b.band);
      if (g > worst) worst = g;
      if (g >= 2) heavy += 1;
      total += g;
    }
    return [worst, heavy, total];
  };
  const strictlyLess = (x: [number, number, number], y: [number, number, number]): boolean =>
    x[0] !== y[0] ? x[0] < y[0] : x[1] !== y[1] ? x[1] < y[1] : x[2] < y[2];

  // #36 cost-neutral DE-HOLD. The base matching (with the protect bonus) can HOLD every free
  // player when enough same-band players are still incoming — total tie-break bonus 30−5p is
  // minimised by committing nothing, so free players idle needlessly (RizzOtto's tournament).
  // Fix: after the base matching, commit any HELD free-free pair that a PURE-cost (bonus-free)
  // max-weight matching proves is a "safe edge" — i.e. committing it does NOT raise the global
  // optimum, so it can never strand a weaker player into a play-up. Only floor edges (Δ0, no
  // rematch → cost 0) are candidates: pairing two equals now is the abundance case; a player
  // reserved for a scarce/weak incoming has a >0 hold and is left alone (scarcity preserved).
  const K_FIXED = 100_000_000; // ≥ any open-pool edge cost, fixed so MWM values compare across sets
  const pureMWM = (nodeList: Waiter[]): number => {
    const n = nodeList.length;
    if (n < 2) return 0;
    const edges: Array<[number, number, number]> = [];
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const s = edgeScaled(nodeList[i]!, nodeList[j]!);
        if (s === null) continue;
        edges.push([i, j, K_FIXED - s]); // pure weight, no protect/commit bonus
      }
    if (edges.length === 0) return 0;
    const mate = blossom(edges);
    let w = 0;
    for (let i = 0; i < n; i++) {
      const j = mate[i] ?? -1;
      if (j > i) w += K_FIXED - edgeScaled(nodeList[i]!, nodeList[j]!)!;
    }
    return w;
  };
  const deHold = (base: { pairs: [Waiter, Waiter][]; byes: Waiter[] }): { pairs: [Waiter, Waiter][]; byes: Waiter[] } => {
    if (inc.length === 0) return base; // closed pool: nobody is held; commits + byes stand
    let field = [...free, ...inc]; // the still-uncommitted sub-field (shrinks as commits are accepted)
    let opt = pureMWM(field);
    // The design invariant: a pairing is committed ONLY if it lies in a max-cardinality-min-cost
    // optimum, so the REMAINING field stays optimal. The base matching's offset only guarantees
    // min-cost at EQUAL cardinality — so it can commit a pair that is NOT in the optimum, e.g. a cheap
    // Δ0 free-free pair that leaves two incoming rematch players unheld and strands them into a forced
    // rematch when they finish (the "finish-last" bug). So FIRST filter every base commit through the
    // SAME pure-MWM optimum check (not just the extras below): keep only those whose removal preserves
    // the optimum; hold the rest. `pureMWM` uses a cardinality-dominant offset (K_FIXED ≥ any pool
    // cost), so "preserves the optimum" means "max matched-count first, then min cost".
    const kept: [Waiter, Waiter][] = [];
    for (const [u, v] of base.pairs) {
      const s = edgeScaled(u, v);
      const reduced = field.filter((w) => w.userId !== u.userId && w.userId !== v.userId);
      if (s !== null && pureMWM(reduced) + (K_FIXED - s) === opt) {
        kept.push([u, v]);
        field = reduced;
        opt = pureMWM(field);
      }
      // else: hold — committing this pair would drop the optimum (strand someone), so leave it open.
    }
    // #36 cost-neutral DE-HOLD extra pass: among players still held, commit any safe floor (Δ0) pair
    // whose removal also preserves the optimum — pairing two equals now is the abundance case.
    const usedIds = new Set<string>();
    for (const [a, b] of kept) { usedIds.add(a.userId); usedIds.add(b.userId); }
    let held = free.filter((f) => !usedIds.has(f.userId));
    const extra: [Waiter, Waiter][] = [];
    let progress = held.length >= 2;
    while (progress && held.length >= 2) {
      progress = false;
      for (let i = 0; i < held.length && !progress; i++)
        for (let j = i + 1; j < held.length; j++) {
          if (edgeScaled(held[i]!, held[j]!) !== 0) continue; // floor edges only (Δ0, no rematch)
          const u = held[i]!, v = held[j]!;
          const reduced = field.filter((w) => w.userId !== u.userId && w.userId !== v.userId);
          if (pureMWM(reduced) + K_FIXED === opt) {
            extra.push([u, v]);
            held = held.filter((w) => w.userId !== u.userId && w.userId !== v.userId);
            field = reduced;
            opt = pureMWM(field);
            progress = true;
            break;
          }
        }
    }
    return { pairs: [...kept, ...extra], byes: base.byes };
  };

  // Pre-assigned bye: in a CLOSED odd pool the caller supplies the ELIGIBLE bye candidates ordered
  // weakest-first (already respecting the never-byed-twice rule). Among them, pick the bye that
  // yields the fewest play-ups — a weak player is often the "glue" that lets their same-band peers
  // avoid a rematch-forced play-up, so blindly byeing the weakest can ADD play-ups. Ties keep the
  // weakest. This preserves the "weakest rests" intent without ever creating extra play-ups.
  // Provisional/open pools are unaffected (no pre-bye there).
  if (closed && free.length % 2 === 1 && pickBye) {
    const ranked = pickBye(free.map((w) => w.userId)); // eligible byes, weakest first
    let chosen: { m: { pairs: [Waiter, Waiter][]; byes: Waiter[] }; byed: Waiter } | null = null;
    let chosenProfile: [number, number, number] | null = null;
    for (const id of ranked) {
      const idx = free.findIndex((w) => w.userId === id);
      if (idx < 0) continue;
      const m = solve(free.filter((_, i) => i !== idx));
      const prof = profile(m);
      if (chosenProfile === null || strictlyLess(prof, chosenProfile)) {
        chosen = { m, byed: free[idx]! };
        chosenProfile = prof;
      }
    }
    if (chosen) {
      chosen.m.byes.push(chosen.byed);
      return chosen.m;
    }
  }

  return deHold(solve(free));
}

/**
 * Compute the pairings (and byes) that should be created right now for a Balanced
 * Liechtenstein tournament, from its participants and current match rows. Pure.
 *
 * Called both at start (no matches yet → pairs the whole of round 1) and after
 * every match completion (pairs the freed players into their next round).
 *
 * `tournamentId` only seeds the deterministic tie-break shuffle so equal-cost optima
 * are reproducible across ticks; it does not otherwise affect the plan.
 */
export function planPairings(
  participants: BalancedParticipant[],
  matches: BalancedMatchRow[],
  roundsCount: number,
  tournamentId = '',
  // Optional: rank the ELIGIBLE odd-one-out bye candidates for a closed round pool (weakest
  // first), given that round's candidate ids. The engine stays score-agnostic — the caller (which
  // has the standings) supplies the ranking; the engine then byes whichever of them creates the
  // fewest play-ups, tie-broken by weakest. An empty array falls back to the Blossom-leftover bye.
  pickBye?: (candidateUserIds: string[], round: number) => string[],
  // Players who may NOT take a bye (already rested — never-bye-twice). Force-matched in every
  // pool so the incremental matching never reserves them a bye the rule will later forbid.
  noBye: Set<string> = new Set<string>(),
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
        // A match in progress already fixes who this player will have "just played" when they
        // enter the NEXT round's pool — register the opponent now (last-opponent + met-before)
        // so the immediate-rematch block fires BEFORE the result lands. Without this, two
        // players still playing EACH OTHER look like valid next-round partners: the optimiser
        // treats that (eventual) rematch as a free Δ0 edge, reserves it, commits their real
        // partners elsewhere, and then force-rematches them once they finish in a now-closed
        // pool (the-dimwitted-ones R2: RizzOtto & PJs, who finished their round last).
        if (opp && roster.has(opp)) {
          pr.pastOpponents.add(opp);
          if (m.round >= pr.lastPlayedRound) {
            pr.lastPlayedRound = m.round;
            pr.lastOpponentId = opp;
          }
        }
      }
      // CANCELLED / voided statuses are ignored (the round will be re-paired).
    }
  }

  // Bucket players by the round pool they are waiting for / incoming to. Incoming
  // players carry their full rematch history so the global matching can weigh a
  // still-playing partner exactly like a free one (bar the immediate-rematch case,
  // which cannot arise between a finished waiter and a mid-game incoming).
  const asWaiter = (pr: Progress): Waiter => ({
    userId: pr.userId,
    band: pr.band,
    lastOpponentId: pr.lastOpponentId,
    pastOpponents: pr.pastOpponents,
  });
  const waitingByRound = new Map<number, Waiter[]>();
  const incomingByRound = new Map<number, Waiter[]>(); // pool round → players still arriving
  for (const pr of progress.values()) {
    if (pr.activeRound !== null) {
      // Currently playing round `activeRound` → will join pool activeRound+1 next.
      const next = pr.activeRound + 1;
      if (next <= roundsCount) {
        const arr = incomingByRound.get(next) ?? [];
        arr.push(asWaiter(pr));
        incomingByRound.set(next, arr);
      }
      continue;
    }
    if (pr.completed >= roundsCount) continue; // done — no more pairing
    const round = pr.completed + 1;
    const list = waitingByRound.get(round) ?? [];
    list.push(asWaiter(pr));
    waitingByRound.set(round, list);
  }

  const pairings: PlannedPairing[] = [];
  const byes: PlannedBye[] = [];
  for (const [round, waiting] of waitingByRound) {
    const { pairs, byes: poolByes } = pairPool(
      waiting,
      incomingByRound.get(round) ?? [],
      `${tournamentId}:${round}`,
      pickBye ? (ids) => pickBye(ids, round) : undefined,
      noBye,
    );
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
// Pools are formed from the TOP, player by player: a level keeps all its own players,
// and a level below the target pool size borrows the best players of the level(s) below
// until it reaches the target (the borrowed player is promoted out of their level). A
// trailing bottom pool that still can't reach MIN_POOL_SIZE is merged into the pool above.
//
// Seeding (BaLi 2.0 — 2026-07-15): there is NO seat-1 own-band reservation. Cross-band
// records are made comparable with a handicap (adjustedSeedScore: −0.2 × rounds per band
// a borrowed player sits below the division's own band), and seeds follow the handicapped
// score. A genuine top-band player who earned it still tops the bracket; a lone 0-5
// top-band player does not (handicap is 0 for own-band, so their raw record decides).
//
// The TARGET pool size is driven by the host's chosen playoff size (targetPoolSizeFrom
// Format): TOP8 → 16 (borrow aggressively → few big mixed divisions), TOP4 → 8, TOP2 → 4
// (minimal borrow → many pure divisional playoffs). The size knob IS the big-top vs
// many-pure-divisions trade-off.
// ---------------------------------------------------------------------------

/** Absolute minimum players a division pool needs before it stands on its own (merge floor). */
export const MIN_POOL_SIZE = 4;

export interface RankedPlayer {
  userId: string;
  band: number;
  /** Final Swiss placement, 1 = best. Drives pool fill order + tie-breaks. */
  rank: number;
  /** Raw Swiss score (wins). Handicapped per band below the division for seeding. */
  rawScore: number;
}

export interface DivisionPool {
  /** The level this pool belongs to (its own players' band). */
  band: number;
  /** Members, best rank first. Includes any players promoted from below. */
  players: RankedPlayer[];
  /**
   * Full playoff seed order (userIds), by handicap-adjusted score (cross-band fair),
   * then Swiss rank. Drives both the bracket size (via its length) and the seeding
   * (1v4, 1v8, …).
   */
  seeds: string[];
  /** The two top seeds — convenience for the TOP2 (final-only) case (null if < 2). */
  finalists: [string, string] | null;
}

/**
 * Playoff bracket size for a division of the given size, mirroring Auto Swiss
 * (thresholds 4 / 8 / 16). A division is always at least MIN_POOL_SIZE, so the
 * floor is TOP2 (final only). Alex-Spec 2026-07-03.
 */
export function divisionPlayoffFormat(poolSize: number): 'TOP2' | 'TOP4' | 'TOP8' {
  if (poolSize >= 16) return 'TOP8';
  if (poolSize >= 8) return 'TOP4';
  return 'TOP2';
}

/**
 * The host's chosen playoff size is a CEILING, not a target: a division's bracket is
 * `divisionPlayoffFormat(size)` but never LARGER than what the host picked. So a TOP2 host
 * choice stays TOP2 however big a division grows (only the top 2 seeds contest a final), and
 * TOP4 only downgrades to TOP2 for a small (<8) division. A null/NONE host format imposes no
 * ceiling — size alone decides (unchanged legacy behaviour). This mirrors the downgrade-only
 * rule the Swiss/Auto-Swiss playoff preview already applies; the host's choice drives how long
 * the tournament runs, so it must never be silently upgraded.
 */
export function cappedDivisionPlayoffFormat(
  poolSize: number,
  hostFormat: string | null | undefined,
): 'TOP2' | 'TOP4' | 'TOP8' {
  const bySize = divisionPlayoffFormat(poolSize);
  const RANK: Record<'TOP2' | 'TOP4' | 'TOP8', number> = { TOP2: 1, TOP4: 2, TOP8: 3 };
  const ceiling = hostFormat === 'TOP2' || hostFormat === 'TOP4' || hostFormat === 'TOP8' ? RANK[hostFormat] : undefined;
  if (ceiling === undefined) return bySize; // no valid host ceiling → size alone decides
  return RANK[bySize] <= ceiling ? bySize : (hostFormat as 'TOP2' | 'TOP4' | 'TOP8');
}

/**
 * Target division size implied by the host's chosen playoff size — this drives how
 * aggressively short divisions borrow from below (2026-07-15). TOP8 fills to 16 (few
 * big mixed divisions), TOP4 to 8, TOP2/NONE to the MIN_POOL_SIZE floor (many pure
 * divisions). It is only a target: a field with too few players simply forms a
 * smaller pool and the bracket auto-downgrades via divisionPlayoffFormat.
 */
export function targetPoolSizeFromFormat(playoffFormat: string | null | undefined): number {
  if (playoffFormat === 'TOP8') return 16;
  if (playoffFormat === 'TOP4') return 8;
  return MIN_POOL_SIZE;
}

/**
 * Group ranked players into division pools top down, borrowing the best of the levels
 * below to fill short levels up to `targetPoolSize`, then seed each pool by the
 * cross-band handicap-adjusted score. Pure.
 *
 * `roundsCount` scales the seeding handicap; `targetPoolSize` (from the host's chosen
 * playoff size) drives the borrowing — see targetPoolSizeFromFormat.
 */
export function formDivisionPools(
  players: RankedPlayer[],
  roundsCount: number,
  targetPoolSize: number = MIN_POOL_SIZE,
): DivisionPool[] {
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

    // Borrow the best available players from the levels below to reach the target size.
    if (members.length < targetPoolSize) {
      for (const c of ordered) {
        if (members.length >= targetPoolSize) break;
        if (c.band < band && !assigned.has(c.userId)) {
          members.push(c);
          assigned.add(c.userId);
        }
      }
    }
    pools.push({ band, players: members, seeds: [], finalists: null });
  }

  // A trailing pool that never reached the absolute minimum joins the pool above it.
  if (pools.length >= 2 && pools[pools.length - 1]!.players.length < MIN_POOL_SIZE) {
    const last = pools.pop()!;
    pools[pools.length - 1]!.players.push(...last.players);
  }

  // Seed by handicap-adjusted score (cross-band fair), tie-broken by Swiss rank. There
  // is NO seat-1 own-band reservation (BaLi 2.0): the handicap already discounts a
  // borrowed lower-band record, so a genuine top-band player who earned it tops the
  // bracket and a lone 0-5 top-band player does not.
  for (const pool of pools) {
    const seeded = [...pool.players].sort(
      (a, b) =>
        adjustedSeedScore(b.rawScore, roundsCount, pool.band, b.band) -
          adjustedSeedScore(a.rawScore, roundsCount, pool.band, a.band) ||
        a.rank - b.rank,
    );
    pool.players = seeded;
    pool.seeds = seeded.map((p) => p.userId);
    pool.finalists = pool.seeds.length >= 2 ? [pool.seeds[0]!, pool.seeds[1]!] : null;
  }

  return pools;
}
