/**
 * Fair bracket seeding for Faction War — the elimination-format counterpart to the Swiss
 * `resolveFactionWarFairness`. See plans/faction-war-bracket-seeding.md.
 *
 * A bracket's structure is fixed once generated, so the only lever is the seed order. This
 * module reorders `participantIds` so that **each player's FIRST real game is as balanced a
 * faction matchup as the data allows** (Alex, 2026-08-16). Concretely it minimises, over the
 * seed assignment:
 *
 *   cost = Σ over players P of  penalty(P's first game)
 *     · a player who plays round 1  → penalty(faction P, faction opponent)
 *     · a bye player (plays round 2 vs the winner of feeder a·b)
 *                                   → Pwin(a,b)·penalty(P,a) + Pwin(b,a)·penalty(P,b)
 *
 * penalty(x,y) = factionUnfairness(x,y)²  (convex — a crass duel hurts far more than several
 * mild ones; a never-played pair is treated as maximally uncertain, never a false 50%).
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

/** The convex faction-matchup penalty (unfairness²) and the advancement probability. */
function makeScorer(data: MatchmakingData) {
  const penalty = (fx: string | null, fy: string | null): number => {
    if (!fx || !fy) return 0;
    const u = data.factionTilt(fx, fy).hasData ? factionUnfairness(data, fx, fy) : 0.5;
    return u * u;
  };
  const winProb = (fx: string | null, fy: string | null): number =>
    !fx || !fy ? 0.5 : logistic(data.factionTilt(fx, fy).tilt);
  return { penalty, winProb };
}

/** Total "each player's first game" penalty for a faction-at-seed-position lookup. */
function costOf(
  games: FirstGame[],
  n: number,
  facAt: (pos: number) => string | null,
  scorer: ReturnType<typeof makeScorer>,
): number {
  const { penalty, winProb } = scorer;
  let c = 0;
  for (let pos = 0; pos < n; pos++) {
    const g = games[pos]!;
    const self = facAt(pos);
    if (g.kind === 'vs') {
      c += penalty(self, facAt(g.opp));
    } else {
      const fa = facAt(g.a);
      const fb = facAt(g.b);
      c += winProb(fa, fb) * penalty(self, fa) + winProb(fb, fa) * penalty(self, fb);
    }
  }
  return c;
}

/**
 * The fairness objective (lower = fairer) of a concrete seed order: the sum over players of their
 * first game's convex faction-matchup penalty. Exposed for testing / diagnostics.
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
 * Reorder `participantIds` so each player's first game is the fairest faction matchup the data
 * allows, for the given elimination format. Pure and deterministic. A player with no locked
 * faction contributes 0 (degrades gracefully). Fields below 4 players are returned unchanged.
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

  const games = buildGames(tournamentId, n, format);
  const scorer = makeScorer(data);
  const facOfPlayer = participantIds.map((id) => factionById.get(id) ?? null);
  const cost = (assign: number[]): number =>
    costOf(games, n, (pos) => (pos < 0 || pos >= n ? null : facOfPlayer[assign[pos]!]!), scorer);

  const rng = makeRng(`fw-seed:${tournamentId}:${n}`);
  const identity = Array.from({ length: n }, (_, i) => i);
  const trials = Math.min(15000, Math.max(2000, n * n * 20));
  const restarts = 5;
  let bestAssign = identity.slice();
  let bestCost = cost(identity);

  for (let r = 0; r < restarts; r++) {
    const assign = identity.slice();
    if (r > 0) {
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [assign[i], assign[j]] = [assign[j]!, assign[i]!];
      }
    }
    let c = cost(assign);
    for (let t = 0; t < trials; t++) {
      const i = Math.floor(rng() * n);
      let j = Math.floor(rng() * n);
      if (i === j) j = (j + 1) % n;
      [assign[i], assign[j]] = [assign[j]!, assign[i]!];
      const nc = cost(assign);
      if (nc <= c) {
        c = nc;
      } else {
        [assign[i], assign[j]] = [assign[j]!, assign[i]!]; // revert
      }
    }
    if (c < bestCost) {
      bestCost = c;
      bestAssign = assign.slice();
    }
  }

  return bestAssign.map((pi) => participantIds[pi]!);
}
