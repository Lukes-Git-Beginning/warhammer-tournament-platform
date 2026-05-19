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
}

export interface DEBracketMatchInput extends BracketMatchInput {
  loser_next_match_id: string | null;
  bracket_side: BracketSide;
}

/**
 * Generate a single-elimination bracket from a list of participant IDs.
 *
 * Seeding: order as delivered (caller may shuffle beforehand).
 * BYE-handling:
 *   - Exactly one player set → status=BYE, winner_id=that player.
 *   - Both null → status=PENDING (empty feeder slot).
 *   - BYE winners are propagated into the next match during generation.
 *
 * Returns matches sorted by (round, match_number).
 */
export function generateSingleElim(
  tournamentId: string,
  participantIds: string[],
): BracketMatchInput[] {
  const libMatches = SingleElimination(participantIds, 1, false, true);

  // First pass: assign UUIDs keyed by (round, match) for cross-referencing.
  const idMap = new Map<string, string>();
  for (const m of libMatches) {
    idMap.set(`${m.round}:${m.match}`, randomUUID());
  }

  // Second pass: build mutable output objects so BYE-propagation can mutate them.
  const outputMap = new Map<string, BracketMatchInput>();

  for (const m of libMatches) {
    const key = `${m.round}:${m.match}`;
    const id = idMap.get(key)!;
    const nextKey = m.win ? `${m.win.round}:${m.win.match}` : null;
    const next_match_id = nextKey ? (idMap.get(nextKey) ?? null) : null;

    const p1 = typeof m.player1 === 'string' ? m.player1 : null;
    const p2 = typeof m.player2 === 'string' ? m.player2 : null;

    let status: MatchStatus = 'PENDING';
    let winner_id: string | null = null;

    const hasBye = (p1 !== null && p2 === null) || (p1 === null && p2 !== null);
    if (hasBye) {
      status = 'BYE';
      winner_id = p1 ?? p2;
    }

    outputMap.set(key, {
      id,
      tournament_id: tournamentId,
      round: m.round,
      match_number: m.match,
      player1_id: p1,
      player2_id: p2,
      status,
      next_match_id,
      winner_id,
    });
  }

  // Third pass: propagate BYE winners into the appropriate slot of the next match.
  // Convention for which slot to fill in the next match:
  //   odd match_number  → player1 slot
  //   even match_number → player2 slot
  for (const m of libMatches) {
    const key = `${m.round}:${m.match}`;
    const entry = outputMap.get(key)!;

    if (entry.status === 'BYE' && entry.winner_id !== null && m.win) {
      const nextKey = `${m.win.round}:${m.win.match}`;
      const nextEntry = outputMap.get(nextKey);
      if (nextEntry) {
        // Place the BYE winner in the free slot of the target match.
        if (nextEntry.player1_id === null) {
          nextEntry.player1_id = entry.winner_id;
        } else if (nextEntry.player2_id === null) {
          nextEntry.player2_id = entry.winner_id;
        }
        // Recalculate BYE status for the target match after propagation.
        const np1 = nextEntry.player1_id;
        const np2 = nextEntry.player2_id;
        if ((np1 !== null && np2 === null) || (np1 === null && np2 !== null)) {
          nextEntry.status = 'BYE';
          nextEntry.winner_id = np1 ?? np2;
        }
        // If both slots are now filled, it's a real match.
        if (np1 !== null && np2 !== null && nextEntry.status === 'BYE') {
          nextEntry.status = 'PENDING';
          nextEntry.winner_id = null;
        }
      }
    }
  }

  const result = Array.from(outputMap.values());
  result.sort((a, b) => a.round - b.round || a.match_number - b.match_number);
  return result;
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
 * BYE handling: non-power-of-2 inputs are padded with null; WB R1 matches with
 * exactly one real player are auto-completed as BYE, winner propagated.
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

  // Pad to power-of-two with null slots
  const seeded: Array<string | null> = participantIds.slice();
  while (seeded.length < S) seeded.push(null);

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
  // 3. Propagate WB R1 BYE winners into WB R2 and LB R1.
  // -------------------------------------------------------------------------
  const byeMap = new Map<string, DEBracketMatchInput>();
  for (const m of all) {
    byeMap.set(m.id, m);
  }

  const wbR1Matches = all.filter((m) => m.round === 1);
  for (const m of wbR1Matches) {
    if (m.status === 'BYE' && m.winner_id !== null) {
      // Advance winner to WB R2
      if (m.next_match_id) {
        const nextMatch = byeMap.get(m.next_match_id);
        if (nextMatch) {
          if (nextMatch.player1_id === null) {
            nextMatch.player1_id = m.winner_id;
          } else if (nextMatch.player2_id === null) {
            nextMatch.player2_id = m.winner_id;
          }
          // Recalculate BYE status for next match
          if (nextMatch.player1_id !== null && nextMatch.player2_id === null) {
            nextMatch.status = 'BYE';
            nextMatch.winner_id = nextMatch.player1_id;
          } else if (nextMatch.player1_id === null && nextMatch.player2_id !== null) {
            nextMatch.status = 'BYE';
            nextMatch.winner_id = nextMatch.player2_id;
          } else if (nextMatch.player1_id !== null && nextMatch.player2_id !== null) {
            nextMatch.status = 'PENDING';
            nextMatch.winner_id = null;
          }
        }
      }
      // BYE winner does NOT drop to LB — only real losers drop.
      // The loser_next_match_id slot in LB R1 stays null until a real WB R1 loser arrives.
      // Since a BYE match has no real loser, the corresponding LB slot remains unfilled
      // and the LB match with only one player will itself become a BYE when resolved.
    }
  }

  // -------------------------------------------------------------------------
  // 4. Sort and return.
  // -------------------------------------------------------------------------
  all.sort((a, b) => a.round - b.round || a.match_number - b.match_number);
  return all;
}
