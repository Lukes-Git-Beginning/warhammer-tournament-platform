import { randomUUID } from 'node:crypto';
import { SingleElimination } from 'tournament-pairings';
import type { BracketSide, MatchStatus } from '@rizzotto/db';

export interface BracketMatchInput {
  id: string;
  tournament_id: string;
  round: number;
  match_number: number;
  player1_id: string | null;
  player2_id: string | null;
  status: MatchStatus;
  next_match_id: string | null;
  winner_id: string | null;
  loser_next_match_id?: string | null;
  phase?: string | null;
}

export interface DEBracketMatchInput extends BracketMatchInput {
  loser_next_match_id: string | null;
  bracket_side: BracketSide;
}

/**
 * Generate a single-elimination bracket from a list of participant IDs.
 *
 * Seeding: order as delivered (caller may shuffle beforehand).
 * BYE-handling (feeder-aware, mirrors the DE fix from 2026-06-03):
 *   - A match is a BYE only when exactly one slot is filled AND no feeder
 *     match still delivers a winner into the free slot. Play-in targets on
 *     non-pow2 fields (5, 9, 12 … players) therefore stay PENDING.
 *   - BYE winners propagate immediately; rounds are processed ascending so
 *     cascades resolve in a single sweep.
 *
 * Returns matches sorted by (round, match_number).
 */
export function generateSingleElim(
  tournamentId: string,
  participantIds: string[],
  opts?: { hasThirdPlace?: boolean },
): BracketMatchInput[] {
  const libMatches = SingleElimination(participantIds, 1, false, true);

  // First pass: assign UUIDs keyed by (round, match) for cross-referencing.
  const idMap = new Map<string, string>();
  for (const m of libMatches) {
    idMap.set(`${m.round}:${m.match}`, randomUUID());
  }

  // Static feeder structure: whose winner flows into which target match.
  const feedersByTarget = new Map<string, string[]>();
  for (const m of libMatches) {
    if (m.win) {
      const target = `${m.win.round}:${m.win.match}`;
      const arr = feedersByTarget.get(target) ?? [];
      arr.push(`${m.round}:${m.match}`);
      feedersByTarget.set(target, arr);
    }
  }

  // Second pass: build mutable output objects; everything starts PENDING.
  const outputMap = new Map<string, BracketMatchInput>();

  for (const m of libMatches) {
    const key = `${m.round}:${m.match}`;
    const id = idMap.get(key)!;
    const nextKey = m.win ? `${m.win.round}:${m.win.match}` : null;
    const next_match_id = nextKey ? (idMap.get(nextKey) ?? null) : null;

    outputMap.set(key, {
      id,
      tournament_id: tournamentId,
      round: m.round,
      match_number: m.match,
      player1_id: typeof m.player1 === 'string' ? m.player1 : null,
      player2_id: typeof m.player2 === 'string' ? m.player2 : null,
      status: 'PENDING',
      next_match_id,
      winner_id: null,
    });
  }

  // Third pass: feeder-aware BYE classification, rounds ascending.
  // A feeder still "delivers" while its winner_id is null — earlier-round
  // BYEs resolve first (their winner is set + propagated), so by the time a
  // later match is visited its remaining feeder count is accurate.
  const unresolvedFeeders = (key: string): number =>
    (feedersByTarget.get(key) ?? []).filter((fk) => outputMap.get(fk)!.winner_id === null)
      .length;

  const sorted = [...libMatches].sort((a, b) => a.round - b.round || a.match - b.match);
  for (const m of sorted) {
    const key = `${m.round}:${m.match}`;
    const entry = outputMap.get(key)!;
    const filled =
      (entry.player1_id !== null ? 1 : 0) + (entry.player2_id !== null ? 1 : 0);

    if (filled !== 1 || unresolvedFeeders(key) > 0) continue;

    entry.status = 'BYE';
    entry.winner_id = entry.player1_id ?? entry.player2_id;

    // Propagate the BYE winner into the free slot of the next match.
    if (m.win) {
      const nextEntry = outputMap.get(`${m.win.round}:${m.win.match}`);
      if (nextEntry) {
        if (nextEntry.player1_id === null) {
          nextEntry.player1_id = entry.winner_id;
        } else if (nextEntry.player2_id === null) {
          nextEntry.player2_id = entry.winner_id;
        }
      }
    }
  }

  const result = Array.from(outputMap.values());
  result.sort((a, b) => a.round - b.round || a.match_number - b.match_number);

  if (opts?.hasThirdPlace) {
    // Find the Final (only match with next_match_id === null in the last round)
    const finalMatch = result.find((m) => m.next_match_id === null);
    if (finalMatch) {
      // Find the two Semi-Finals (matches whose winner flows into the Final)
      const semis = result.filter((m) => m.next_match_id === finalMatch.id);
      if (semis.length === 2) {
        const thirdPlaceId = randomUUID();
        // Wire the loser connectors on both SFs
        for (const semi of semis) {
          semi.loser_next_match_id = thirdPlaceId;
        }
        // Add the third-place match in the same round as the Final
        result.push({
          id: thirdPlaceId,
          tournament_id: tournamentId,
          round: finalMatch.round,
          match_number: 2,
          player1_id: null,
          player2_id: null,
          status: 'PENDING',
          next_match_id: null,
          winner_id: null,
          loser_next_match_id: null,
          phase: 'PLAYOFF_THIRD_PLACE',
        });
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Double-Elimination progression slot decision
// ---------------------------------------------------------------------------

/** A single way a source match feeds a target: its winner advances, or its loser drops. */
export interface FeederEvent {
  matchId: string;
  round: number;
  matchNumber: number;
  role: 'winner' | 'loser';
}

/**
 * Order-independent slot decision for double-elimination progression.
 *
 * Every target match has at most two incoming feed events — a winner advancing
 * (next_match_id) and/or a loser dropping (loser_next_match_id) from a source
 * match. We sort those events deterministically by (round, matchNumber, role)
 * and map slot index 0 → player1, 1 → player2. Because the ordering depends
 * only on the static bracket structure (never on the order results are
 * reported), a given source always lands in the same slot — so a winner-advance
 * and a loser-drop into the same lower-bracket match can never overwrite each
 * other regardless of play order.
 *
 * For the grand final (WB-final winner + LB-final winner) the WB final has the
 * lower round → player1, the LB final → player2, matching the bracket-reset
 * convention (WB champion in player1, LB champion in player2).
 */
export function slotForFeeder(
  feeders: FeederEvent[],
  srcMatchId: string,
  srcRole: 'winner' | 'loser',
): 'player1_id' | 'player2_id' {
  const sorted = [...feeders].sort(
    (a, b) =>
      a.round - b.round ||
      a.matchNumber - b.matchNumber ||
      (a.role === b.role ? 0 : a.role === 'winner' ? -1 : 1),
  );
  const idx = sorted.findIndex((e) => e.matchId === srcMatchId && e.role === srcRole);
  return idx === 1 ? 'player2_id' : 'player1_id';
}

// ---------------------------------------------------------------------------
// Double-Elimination bracket generator
// ---------------------------------------------------------------------------

/** Round up to the next power of two (>= 2). */
function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * Standard single-elimination seed order for a `size`-slot bracket (power of
 * two). Returns the seed numbers (1-based) in bracket-slot order so the top
 * seed meets the bottom seed first and byes (seed numbers > participant count)
 * are distributed to the strongest seeds. e.g. size 4 → [1,4,2,3];
 * size 8 → [1,8,4,5,2,7,3,6]. Because N > size/2 always holds (size = nextPow2),
 * every first-round pairing receives at least one real player — no empty match.
 */
function seedSlotOrder(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) {
    const n = order.length * 2;
    const next: number[] = [];
    for (const s of order) {
      next.push(s);
      next.push(n + 1 - s);
    }
    order = next;
  }
  return order;
}

/**
 * Generate a double-elimination bracket for `participantIds`.
 *
 * Round numbering (no overlaps, satisfies @@unique([tournament_id, round, match_number])):
 *   WB rounds         : 1 .. R_W          (R_W = log2(N))
 *   LB rounds         : R_W+1 .. R_W+R_L  (R_L = 2*R_W - 1)
 *   Grand Final round : R_W + R_L + 1
 *   Reset round       : R_W + R_L + 2
 *
 * WB → LB drop-mapping (classic DE):
 *   WB round r losers drop into the LB "drop" round that corresponds to r.
 *   For R_W rounds of WB, losers from WB round r drop into LB round (2r - 1).
 *   Within the drop round, WB match i's loser is paired against WB match (i XOR 1)
 *   loser or placed in LB match ceil(i/2) depending on the LB structure.
 *
 *   Concretely for S players (S is power of 2):
 *     LB is organised as alternating rounds:
 *       LB1 (drop from WB1):  S/4 matches  — losers of WB1 meet each other
 *       LB2 (consol):         S/4 matches  — LB1 winners meet each other
 *       LB3 (drop from WB2):  S/8 matches  — losers of WB2 vs LB2 winners
 *       LB4 (consol):         S/8 matches  — LB3 winners
 *       ...
 *       LB(2*R_W-2) (consol): 1 match      — LB semi-final result
 *       (no final LB consol for last WB loser — goes directly to GF)
 *
 * BYE handling: non-power-of-2 inputs are distributed across the first round via
 * standard seed ordering so no first-round match is empty. A topological pass
 * then resolves byes and phantom (player-less) lower-bracket matches up front,
 * advancing deterministic bye winners and neutralising phantoms.
 *
 * Returns matches sorted by (round, match_number).
 */
export function generateDoubleElim(
  tournamentId: string,
  participantIds: string[],
): DEBracketMatchInput[] {
  const S = nextPow2(Math.max(participantIds.length, 2));
  const R_W = Math.log2(S); // WB rounds
  const R_L = 2 * R_W - 1; // LB rounds

  // Distribute byes across the first round via standard bracket seed order so
  // every WB round-1 pairing gets at least one real player (no empty matches).
  const slotOrder = seedSlotOrder(S);
  const seeded: Array<string | null> = slotOrder.map((seed) =>
    seed <= participantIds.length ? participantIds[seed - 1]! : null,
  );

  // -------------------------------------------------------------------------
  // 1. Pre-generate all UUIDs so cross-references can be set in one pass.
  // -------------------------------------------------------------------------

  // WB matches[wbRound-1][matchIndex]  (0-indexed internally)
  const wbIds: string[][] = [];
  for (let r = 0; r < R_W; r++) {
    const count = S >> (r + 1); // S/2, S/4, ...
    wbIds.push(Array.from({ length: count }, () => randomUUID()));
  }

  // LB matches[lbRound-1][matchIndex]
  // LB round 1 has S/4 matches (losers of WB R1 play each other)
  // Each subsequent pair of LB rounds halves the match count.
  const lbIds: string[][] = [];
  for (let r = 0; r < R_L; r++) {
    // For LB round r (0-indexed):
    //   "drop" rounds (even r) → receives WB losers, same count as WB round (r/2+1) output/2
    //   "consol" rounds (odd r) → internal consolidation, same count as previous drop round
    // Unified formula: count = S >> (floor(r/2) + 2)
    const count = S >> (Math.floor(r / 2) + 2);
    lbIds.push(Array.from({ length: Math.max(count, 1) }, () => randomUUID()));
  }

  const grandFinalId = randomUUID();
  const resetMatchId = randomUUID();

  // -------------------------------------------------------------------------
  // 2. Build match objects.
  // -------------------------------------------------------------------------
  const all: DEBracketMatchInput[] = [];

  // --- Winners Bracket ---
  for (let r = 0; r < R_W; r++) {
    const roundNum = r + 1; // 1-indexed
    const matchCount = wbIds[r]!.length;

    for (let i = 0; i < matchCount; i++) {
      const id = wbIds[r]![i]!;

      // next_match_id: WB final (r === R_W-1) goes to Grand Final; otherwise next WB round match i/2
      const next_match_id: string | null =
        r === R_W - 1 ? grandFinalId : (wbIds[r + 1]![Math.floor(i / 2)]! ?? null);

      // loser_next_match_id: which LB match receives this WB loser?
      // WB round r (0-indexed) losers drop into LB round (2r) (0-indexed).
      // Within that LB drop round, WB match i drops into LB match floor(i/2).
      let loser_next_match_id: string | null = null;
      const lbDropRoundIdx = 2 * r; // 0-indexed LB round
      if (lbDropRoundIdx < R_L) {
        // Special case: WB R1 (r=0) losers play each other in LB R1.
        // WB R1 M0 loser → LB R1 M0 player1, WB R1 M1 loser → LB R1 M0 player2
        // WB R1 M2 loser → LB R1 M1 player1, WB R1 M3 loser → LB R1 M1 player2
        // General: WB Rr Mi loser → LB drop-round floor(i/2), as player1 (even i) or player2 (odd i)
        const lbMatchIdx = Math.floor(i / 2);
        if (lbMatchIdx < lbIds[lbDropRoundIdx]!.length) {
          loser_next_match_id = lbIds[lbDropRoundIdx]![lbMatchIdx]!;
        }
      } else {
        // WB final loser drops directly into Grand Final as LB champion seed
        // (handled separately — WB final loser actually goes to LB final, which IS lbIds[R_L-1][0])
        loser_next_match_id = lbIds[R_L - 1]![0]!;
      }

      // Players: only set for WB R1 from seeded list
      let player1_id: string | null = null;
      let player2_id: string | null = null;
      if (r === 0) {
        player1_id = seeded[2 * i] ?? null;
        player2_id = seeded[2 * i + 1] ?? null;
      }

      let status: MatchStatus = 'PENDING';
      let winner_id: string | null = null;
      if (r === 0) {
        if (player1_id !== null && player2_id === null) {
          status = 'BYE';
          winner_id = player1_id;
        } else if (player1_id === null && player2_id !== null) {
          status = 'BYE';
          winner_id = player2_id;
        }
      }

      all.push({
        id,
        tournament_id: tournamentId,
        round: roundNum,
        match_number: i + 1,
        player1_id,
        player2_id,
        status,
        next_match_id,
        loser_next_match_id,
        bracket_side: 'WINNERS',
        winner_id,
      });
    }
  }

  // --- Losers Bracket ---
  for (let r = 0; r < R_L; r++) {
    const roundNum = R_W + r + 1; // shifted after WB rounds
    const matchCount = lbIds[r]!.length;

    for (let i = 0; i < matchCount; i++) {
      const id = lbIds[r]![i]!;

      // next_match_id: last LB round goes to Grand Final, otherwise next LB round match floor(i/2)
      // Consol rounds (odd r) and drop rounds (even r) both feed forward:
      // After each "pair" (drop + consol) the count halves, so from any round r to r+1
      // match i feeds into floor(i/2) of round r+1 (for consol rounds).
      // From consol (odd) to next drop (even): match i feeds into match i of next round
      // (counts are equal between consecutive drop and consol rounds).
      const next_match_id: string | null =
        r === R_L - 1
          ? grandFinalId
          : r % 2 === 0
            ? (lbIds[r + 1]![i]! ?? null) // drop → consol: 1:1
            : (lbIds[r + 1]![Math.floor(i / 2)]! ?? null); // consol → drop: halves

      all.push({
        id,
        tournament_id: tournamentId,
        round: roundNum,
        match_number: i + 1,
        player1_id: null,
        player2_id: null,
        status: 'PENDING',
        next_match_id,
        loser_next_match_id: null,
        bracket_side: 'LOSERS',
        winner_id: null,
      });
    }
  }

  // --- Grand Final ---
  // player1 = WB champion (filled by WB final winner_progression), player2 = LB champion
  all.push({
    id: grandFinalId,
    tournament_id: tournamentId,
    round: R_W + R_L + 1,
    match_number: 1,
    player1_id: null,
    player2_id: null,
    status: 'PENDING',
    next_match_id: resetMatchId,
    loser_next_match_id: null,
    bracket_side: 'GRAND_FINAL',
    winner_id: null,
  });

  // --- Reset Match (only activated if LB champion wins GF) ---
  all.push({
    id: resetMatchId,
    tournament_id: tournamentId,
    round: R_W + R_L + 2,
    match_number: 1,
    player1_id: null,
    player2_id: null,
    status: 'PENDING',
    next_match_id: null,
    loser_next_match_id: null,
    bracket_side: 'GRAND_FINAL',
    winner_id: null,
  });

  // -------------------------------------------------------------------------
  // 3. Resolve byes and phantom matches up-front via a topological pass.
  //
  // With distributed seeding every WB round-1 pairing has >=1 real player, but
  // non-power-of-2 fields still leave lower-bracket matches whose feeders
  // produce no real loser. We walk matches in (round, match_number) order — so
  // every feeder is processed before its target — and classify each as REAL
  // (>=2 incoming players), BYE (exactly 1) or PHANTOM (0). Deterministic bye
  // winners are advanced into their next match using the SAME feeder ordering
  // the runtime uses (slotForFeeder), so generation- and runtime-placed players
  // never collide. PHANTOM matches are marked terminal so they cannot stall
  // progression. Grand final + reset are left to the result handler at runtime.
  // -------------------------------------------------------------------------
  const winnerFeedersOf = new Map<string, DEBracketMatchInput[]>();
  const loserFeedersOf = new Map<string, DEBracketMatchInput[]>();
  for (const m of all) {
    if (m.next_match_id) {
      const list = winnerFeedersOf.get(m.next_match_id) ?? [];
      list.push(m);
      winnerFeedersOf.set(m.next_match_id, list);
    }
    if (m.loser_next_match_id) {
      const list = loserFeedersOf.get(m.loser_next_match_id) ?? [];
      list.push(m);
      loserFeedersOf.set(m.loser_next_match_id, list);
    }
  }
  const byId = new Map(all.map((m) => [m.id, m]));

  const feederEventsFor = (targetId: string): FeederEvent[] => {
    const events: FeederEvent[] = [];
    for (const f of winnerFeedersOf.get(targetId) ?? [])
      events.push({ matchId: f.id, round: f.round, matchNumber: f.match_number, role: 'winner' });
    for (const f of loserFeedersOf.get(targetId) ?? [])
      events.push({ matchId: f.id, round: f.round, matchNumber: f.match_number, role: 'loser' });
    return events;
  };

  const placeForward = (srcId: string, targetId: string, playerId: string) => {
    const target = byId.get(targetId);
    if (!target) return;
    const slot = slotForFeeder(feederEventsFor(targetId), srcId, 'winner');
    if (slot === 'player1_id') target.player1_id = playerId;
    else target.player2_id = playerId;
  };

  type Classification = 'REAL' | 'BYE' | 'PHANTOM';
  const classification = new Map<string, Classification>();

  const topo = [...all].sort((a, b) => a.round - b.round || a.match_number - b.match_number);
  for (const m of topo) {
    if (m.bracket_side === 'GRAND_FINAL') {
      classification.set(m.id, 'REAL');
      continue;
    }

    // Concrete players already in this match's slots (seeded round-1 players or
    // deterministic bye winners pushed in by earlier-processed feeders).
    const concrete = [m.player1_id, m.player2_id].filter((x): x is string => x !== null);

    // Feeders that will deliver an as-yet-undetermined player at runtime.
    let undetermined = 0;
    for (const f of winnerFeedersOf.get(m.id) ?? []) {
      const c = classification.get(f.id);
      if (c === 'PHANTOM') continue; // sends no winner
      if (c === 'BYE' && f.winner_id !== null) continue; // already pushed (counted in concrete)
      undetermined++; // REAL match, or pass-through bye (winner not yet known)
    }
    for (const f of loserFeedersOf.get(m.id) ?? []) {
      if (classification.get(f.id) === 'REAL') undetermined++; // only real matches drop a loser
    }

    const total = concrete.length + undetermined;
    if (total >= 2) {
      classification.set(m.id, 'REAL');
    } else if (total === 1) {
      classification.set(m.id, 'BYE');
      if (concrete.length === 1) {
        // Deterministic bye — winner known now, mark it and advance forward.
        m.status = 'BYE';
        m.winner_id = concrete[0]!;
        if (m.next_match_id) placeForward(m.id, m.next_match_id, concrete[0]!);
      }
      // else: pass-through bye — its single player arrives at runtime, where the
      // result handler promotes it once its real feeder reports.
    } else {
      // PHANTOM — no players will ever arrive; mark terminal so it never blocks.
      classification.set(m.id, 'PHANTOM');
      m.status = 'BYE';
      m.winner_id = null;
    }
  }

  // -------------------------------------------------------------------------
  // 4. Sort and return.
  // -------------------------------------------------------------------------
  all.sort((a, b) => a.round - b.round || a.match_number - b.match_number);
  return all;
}
