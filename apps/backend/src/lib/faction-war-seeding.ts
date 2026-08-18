/**
 * Fair bracket seeding for Faction War — the elimination-format counterpart to the Swiss
 * `resolveFactionWarFairness`. See plans/faction-war-bracket-seeding.md.
 *
 * A bracket's structure is fixed once generated, so the only lever is the seed order. This
 * module reorders `participantIds` so that **each player's FIRST real game is as balanced a
 * faction matchup as the data allows** (Alex, 2026-08-16). The objective is MINIMAX over the
 * seed assignment: minimise the WORST player's first-game imbalance, then the sum of squared
 * imbalances as a tie-break. Each player's first game counts once — a round-1 match and a bye's
 * round-2 game are on equal footing — so round 1 is never over-weighted at round 2's expense
 * (seeding round 1 already accounts for the round-2 matchups it leads to).
 *
 *   imbalance(P) = |winChance − 0.5| ∈ [0, 0.5]
 *     · a player who plays round 1  → imbalance(faction P vs opponent)
 *     · a bye player (plays round 2 vs the winner of feeder a·b)
 *                                   → max( imb(P,a), imb(P,b) )  (worst of the two possible)
 *
 * A never-played faction pair is treated as maximally uncertain (imbalance 0.5), never a false 50%.
 *
 * The structure (which seeds get byes, the round-1 pairings, and which round-1 match each bye
 * sits above) is read straight from the real generator's output on positional placeholders, so
 * it is correct for whatever seeding Single/Double Elimination actually use — not a re-derived
 * formula. The optimiser is a seeded local search (deterministic per tournament).
 */

import { factionUnfairness, type MatchmakingData } from './matchmaking.js';
import { logistic } from './rating-model.js';
import { generateSingleElim, generateDoubleElim } from './bracket.js';

/** The structural fields we read off a generated bracket match (SE tree, or DE winners bracket). */
interface SeedMatch {
  id: string;
  round: number;
  player1_id: string | null;
  player2_id: string | null;
  next_match_id: string | null;
  bracket_side?: string | null;
}

/** A seed position's first real game, expressed in terms of other seed positions. */
type FirstGame =
  | { kind: 'vs'; opp: number } // known opponent (or -1 = none, e.g. a lone-bye half → 0 cost)
  | { kind: 'vsWinner'; a: number; b: number }; // the winner of the a-vs-b feeder match

export type SeedableFormat = 'SINGLE_ELIMINATION' | 'DOUBLE_ELIMINATION';

/** Derive each seed position's first real game from a positional bracket (players are '0'..'n-1'). */
function extractFirstGames(matches: SeedMatch[], n: number): FirstGame[] {
  const wb = matches.filter((m) => m.bracket_side == null || m.bracket_side === 'WINNERS');
  const byId = new Map(wb.map((m) => [m.id, m]));
  const posOf = (pid: string | null): number | null => {
    if (pid == null) return null;
    const p = Number(pid);
    return Number.isInteger(p) && p >= 0 && p < n ? p : null;
  };
  // The earliest match each position is directly seeded into.
  const seededAt = new Map<number, SeedMatch>();
  for (const m of [...wb].sort((a, b) => a.round - b.round)) {
    for (const pid of [m.player1_id, m.player2_id]) {
      const pos = posOf(pid);
      if (pos != null && !seededAt.has(pos)) seededAt.set(pos, m);
    }
  }
  // Incoming feeders per match id (whose winner flows in).
  const feedersOf = new Map<string, SeedMatch[]>();
  for (const m of wb) {
    if (m.next_match_id) {
      const arr = feedersOf.get(m.next_match_id) ?? [];
      arr.push(m);
      feedersOf.set(m.next_match_id, arr);
    }
  }
  // The opponent a bye faces = the winner of the feeder match (which itself may be a lone bye).
  const winnerOf = (m: SeedMatch | undefined): FirstGame => {
    if (!m) return { kind: 'vs', opp: -1 };
    const a = posOf(m.player1_id);
    const b = posOf(m.player2_id);
    if (a != null && b != null) return { kind: 'vsWinner', a, b };
    if (a != null) return { kind: 'vs', opp: a };
    if (b != null) return { kind: 'vs', opp: b };
    return { kind: 'vs', opp: -1 };
  };

  const games: FirstGame[] = new Array(n);
  for (let pos = 0; pos < n; pos++) {
    const entry = seededAt.get(pos);
    if (!entry) {
      games[pos] = { kind: 'vs', opp: -1 };
      continue;
    }
    const a = posOf(entry.player1_id);
    const b = posOf(entry.player2_id);
    const opp = a === pos ? b : a;
    if (opp != null) {
      games[pos] = { kind: 'vs', opp }; // plays a real round-1 game
      continue;
    }
    // Bye. Two representations:
    //  (SE) `entry` is the round-2 match; the empty slot is filled by a feeder round-1 match.
    const incoming = feedersOf.get(entry.id) ?? [];
    if (incoming.length > 0) {
      games[pos] = winnerOf(incoming[0]);
      continue;
    }
    //  (DE) `entry` is a round-1 bye match; follow to the next match, opponent = the other feeder.
    if (entry.next_match_id && byId.has(entry.next_match_id)) {
      const other = (feedersOf.get(entry.next_match_id) ?? []).filter((f) => f.id !== entry.id);
      games[pos] = winnerOf(other[0]);
      continue;
    }
    games[pos] = { kind: 'vs', opp: -1 };
  }
  return games;
}

/** Deterministic PRNG (xmur3 seed → mulberry32) so a tournament always seeds the same bracket. */
function makeRng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = (h ^ (h >>> 16)) >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build the fixed first-game structure for `n` seeds in the given format. */
function buildGames(tournamentId: string, n: number, format: SeedableFormat): FirstGame[] {
  const positions = Array.from({ length: n }, (_, i) => String(i));
  const probe: SeedMatch[] =
    format === 'DOUBLE_ELIMINATION'
      ? generateDoubleElim(tournamentId, positions, {})
      : generateSingleElim(tournamentId, positions);
  return extractFirstGames(probe, n);
}

/** The faction-matchup imbalance |winChance − 0.5| ∈ [0, 0.5], and the advancement probability. */
function makeScorer(data: MatchmakingData) {
  const unfair = (fx: string | null, fy: string | null): number => {
    if (!fx || !fy) return 0; // a player with no locked faction contributes nothing
    return data.factionTilt(fx, fy).hasData ? factionUnfairness(data, fx, fy) : 0.5;
  };
  const winProb = (fx: string | null, fy: string | null): number =>
    !fx || !fy ? 0.5 : logistic(data.factionTilt(fx, fy).tilt);
  return { unfair, winProb };
}

/**
 * Objective (lower = fairer): the sum, over the bracket's MATCHES (not players), of the SQUARED
 * deviation from a 50/50 matchup — so 1pp costs 1, 3pp costs 9, 8pp costs 64. Each real round-1
 * match is counted ONCE (deduped by opp > pos); each bye's round-2 match is counted once, as the
 * advancement-weighted EXPECTED squared deviation over its two possible opponents. `unfair` is the
 * [0, 0.5] fraction; squaring it minimises the same thing as squaring the percentage-point
 * deviation (they differ only by a constant 10000×). All matches carry equal weight.
 */
function costOf(
  games: FirstGame[],
  n: number,
  facAt: (pos: number) => string | null,
  scorer: ReturnType<typeof makeScorer>,
): number {
  const { unfair, winProb } = scorer;
  let cost = 0;
  for (let pos = 0; pos < n; pos++) {
    const g = games[pos]!;
    const self = facAt(pos);
    if (g.kind === 'vs') {
      if (g.opp > pos) {
        const d = unfair(self, facAt(g.opp)); // a round-1 match — counted once
        cost += d * d;
      }
    } else {
      const fa = facAt(g.a); // a bye's round-2 match vs the winner of a·b
      const fb = facAt(g.b);
      const da = unfair(self, fa);
      const db = unfair(self, fb);
      cost += winProb(fa, fb) * da * da + winProb(fb, fa) * db * db;
    }
  }
  return cost;
}

/**
 * Per-match metrics of an assignment: the sum-of-squares cost, the worst single match deviation
 * (peak), and how many matches are "problematic" (deviation ≥ 5pp). Round-2 (a bye) is scored by
 * the WORSE of its two possible opponents for peak/problematic (a match that could be lopsided),
 * while cost stays the advancement-weighted expectation (matches costOf).
 */
function matchMetrics(
  games: FirstGame[],
  n: number,
  facAt: (pos: number) => string | null,
  scorer: ReturnType<typeof makeScorer>,
): { cost: number; peak: number; problematic: number } {
  const { unfair, winProb } = scorer;
  let cost = 0;
  let peak = 0;
  let problematic = 0;
  const tally = (worst: number) => {
    if (worst > peak) peak = worst;
    if (worst >= 0.05) problematic++;
  };
  for (let pos = 0; pos < n; pos++) {
    const g = games[pos]!;
    const self = facAt(pos);
    if (g.kind === 'vs') {
      if (g.opp > pos) {
        const d = unfair(self, facAt(g.opp));
        cost += d * d;
        tally(d);
      }
    } else {
      const fa = facAt(g.a);
      const fb = facAt(g.b);
      const da = unfair(self, fa);
      const db = unfair(self, fb);
      cost += winProb(fa, fb) * da * da + winProb(fb, fa) * db * db;
      tally(da > db ? da : db);
    }
  }
  return { cost, peak, problematic };
}

/**
 * A canonical key identifying the bracket's actual matches (role-aware), for de-duplicating distinct
 * seed partitions. Two assignments share a key iff they produce the same round-1 matches AND the
 * same bye→feeder pods.
 */
function partitionKey(games: FirstGame[], n: number, facAt: (pos: number) => string | null): string {
  const pair = (x: string, y: string) => (x < y ? `${x},${y}` : `${y},${x}`);
  const parts: string[] = [];
  for (let pos = 0; pos < n; pos++) {
    const g = games[pos]!;
    if (g.kind === 'vs') {
      if (g.opp > pos) parts.push(pair(facAt(pos) ?? '?', facAt(g.opp) ?? '?'));
    } else {
      parts.push(`${facAt(pos) ?? '?'}:${pair(facAt(g.a) ?? '?', facAt(g.b) ?? '?')}`);
    }
  }
  return parts.sort().join(' | ');
}

/**
 * The fairness objective (lower = fairer) of a concrete seed order: the per-match sum of squared
 * deviations from 50/50 (see costOf). Exposed for testing / diagnostics.
 */
export function evaluateFirstGameCost(
  tournamentId: string,
  order: string[],
  factionById: Map<string, string | null>,
  data: MatchmakingData,
  format: SeedableFormat,
): number {
  const n = order.length;
  if (n < 2) return 0;
  const games = buildGames(tournamentId, n, format);
  const facAt = (pos: number): string | null =>
    pos < 0 || pos >= n ? null : factionById.get(order[pos]!) ?? null;
  return costOf(games, n, facAt, makeScorer(data));
}

/**
 * Reorder `participantIds` into a fair Faction-War elimination seeding: one of the (up to 5) best
 * distinct bracket partitions, chosen at random per tournament so a recurring same-faction field
 * doesn't always draw the identical matchups. "Best" keeps every round-1 match and every bye's
 * round-2 match as close to a 50/50 faction matchup as the data allows, ranked by lowest peak
 * deviation, then fewest problematic (≥5pp) matches, then lowest total squared deviation. The
 * candidate pool depends only on the FIELD of factions (deterministic); only the final pick is
 * seeded by `tournamentId`. Pure. A player with no locked faction contributes 0 (degrades
 * gracefully). Fields below 4 players are returned unchanged.
 */
export function seedFactionWarOrder(
  tournamentId: string,
  participantIds: string[],
  factionById: Map<string, string | null>,
  data: MatchmakingData,
  format: SeedableFormat,
): string[] {
  const n = participantIds.length;
  if (n < 4) return participantIds.slice();

  // Canonical player order (sorted by faction) so the candidate POOL depends only on the FIELD of
  // factions — not on registration order or the tournament id. The same set of factions always
  // yields the same top partitions; only the final random pick (seeded by the tournament id) varies,
  // so a recurring same-faction field gets a different one of the best brackets each time.
  const canon = participantIds
    .map((id, i) => ({ i, fac: factionById.get(id) ?? '' }))
    .sort((a, b) => (a.fac < b.fac ? -1 : a.fac > b.fac ? 1 : a.i - b.i))
    .map((x) => x.i);
  const facOfCanon = canon.map((ci) => factionById.get(participantIds[ci]!) ?? null);
  const fieldKey = facOfCanon.map((f) => f ?? '∅').join(',');

  const games = buildGames(fieldKey, n, format);
  const scorer = makeScorer(data);
  const facAtOf =
    (assign: number[]) =>
    (pos: number): string | null =>
      pos < 0 || pos >= n ? null : facOfCanon[assign[pos]!]!;

  // Dense slot×slot lookup tables so the hot optimisation loop is pure array math (no per-swap Map
  // or string work): U = fraction-unfairness ∈ [0, 0.5], W = P(row faction beats col faction). Both
  // are indexed by CANONICAL slot. This is what makes running many restarts live affordable.
  const U: number[][] = [];
  const W: number[][] = [];
  for (let a = 0; a < n; a++) {
    U[a] = new Array<number>(n);
    W[a] = new Array<number>(n);
    for (let b = 0; b < n; b++) {
      U[a]![b] = scorer.unfair(facOfCanon[a] ?? null, facOfCanon[b] ?? null);
      W[a]![b] = scorer.winProb(facOfCanon[a] ?? null, facOfCanon[b] ?? null);
    }
  }
  const cost = (assign: number[]): number => {
    let c = 0;
    for (let pos = 0; pos < n; pos++) {
      const g = games[pos]!;
      const si = assign[pos]!;
      if (g.kind === 'vs') {
        if (g.opp > pos) {
          const d = U[si]![assign[g.opp]!]!;
          c += d * d;
        }
      } else {
        const sa = assign[g.a]!;
        const sb = assign[g.b]!;
        const da = U[si]![sa]!;
        const db = U[si]![sb]!;
        c += W[sa]![sb]! * da * da + W[sb]![sa]! * db * db;
      }
    }
    return c;
  };

  const rng = makeRng(`fw-seed:${fieldKey}:${n}`);
  const identity = Array.from({ length: n }, (_, i) => i);
  const trials = Math.min(20000, Math.max(4000, n * n * 40));
  const restarts = 48;
  const T0 = Math.max(cost(identity), 1e-4) * 0.5;
  const cooling = Math.pow(1e-6 / T0, 1 / trials);

  // Greedy descent to a true local minimum (in place).
  const polish = (assign: number[]): void => {
    let c = cost(assign);
    for (let improved = true; improved; ) {
      improved = false;
      for (let i = 0; i < n && !improved; i++) {
        for (let j = i + 1; j < n; j++) {
          [assign[i], assign[j]] = [assign[j]!, assign[i]!];
          const nc = cost(assign);
          if (nc < c - 1e-12) {
            c = nc;
            improved = true;
            break;
          }
          [assign[i], assign[j]] = [assign[j]!, assign[i]!]; // revert
        }
      }
    }
  };

  // Collect DISTINCT candidate partitions across many simulated-annealing restarts (pure hill-
  // climbing gets trapped in local minima of this QAP-like sum), so we can offer VARIETY across
  // tournaments below instead of always the single deterministic optimum.
  type Cand = { assign: number[]; peak: number; problematic: number; cost: number };
  const candidates = new Map<string, Cand>();
  const consider = (assign: number[]): void => {
    polish(assign);
    const facAt = facAtOf(assign);
    const key = partitionKey(games, n, facAt);
    const m = matchMetrics(games, n, facAt, scorer);
    const prev = candidates.get(key);
    if (!prev || m.cost < prev.cost) candidates.set(key, { assign: assign.slice(), ...m });
  };

  for (let r = 0; r < restarts; r++) {
    const assign = identity.slice();
    if (r > 0) {
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [assign[i], assign[j]] = [assign[j]!, assign[i]!];
      }
    }
    let c = cost(assign);
    let runBest = c;
    let runBestAssign = assign.slice();
    let T = T0;
    for (let t = 0; t < trials; t++) {
      const i = Math.floor(rng() * n);
      let j = Math.floor(rng() * n);
      if (i === j) j = (j + 1) % n;
      [assign[i], assign[j]] = [assign[j]!, assign[i]!];
      const nc = cost(assign);
      const dE = nc - c;
      if (dE <= 0 || rng() < Math.exp(-dE / T)) {
        c = nc;
        if (c < runBest) {
          runBest = c;
          runBestAssign = assign.slice();
        }
      } else {
        [assign[i], assign[j]] = [assign[j]!, assign[i]!]; // revert
      }
      T *= cooling;
    }
    consider(runBestAssign);
  }

  const ranked = [...candidates.values()].sort(
    // Alex's rule: lowest peak first, then fewest problematic (≥5pp) matches, then lowest cost.
    (a, b) => a.peak - b.peak || a.problematic - b.problematic || a.cost - b.cost,
  );
  if (ranked.length === 0) return participantIds.slice();

  // Pool for the random pick: every partition tied at the MINIMUM peak (no bracket carries an
  // unnecessarily hard match), ordered by the rule, capped at 5. If that leaves too few for real
  // variety, relax to the best 3 overall.
  const minPeak = ranked[0]!.peak;
  let pool = ranked.filter((c) => c.peak <= minPeak + 1e-9);
  if (pool.length < 3) pool = ranked.slice(0, Math.min(3, ranked.length));
  pool = pool.slice(0, 5);

  // Pick one — seeded by the tournament id, so it's reproducible for THIS tournament yet varies
  // across tournaments (a recurring same-faction field won't always get the identical bracket).
  const pick = Math.floor(makeRng(`fw-pick:${tournamentId}:${n}`)() * pool.length);
  // `assign` maps a bracket position to a CANONICAL slot; resolve that back to the real participant.
  return pool[Math.min(pick, pool.length - 1)]!.assign.map((slot) => participantIds[canon[slot]!]!);
}
