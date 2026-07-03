import type { BracketNode, SwissMeta } from '@rizzotto/types';

export interface EliminationPlacementData {
  /** Explicit 1–4 placements derived from GF / TP match results. */
  placements: Map<string, 1 | 2 | 3 | 4>;
  /** Round number of each player's last completed match (for sorting unranked players). */
  lastCompletedRound: Map<string, number>;
  /** IDs of the two Grand Final participants (for GF section highlight). */
  gfParticipants: Set<string>;
}

/**
 * Derives placement data for single/double elimination brackets.
 * Explicit ranks 1–4 come from GF and third-place match results.
 * Remaining players are ordered by the round of their last completed match.
 */
export function getEliminationPlacements(matches: BracketNode[]): EliminationPlacementData {
  const placements = new Map<string, 1 | 2 | 3 | 4>();
  const gfParticipants = new Set<string>();

  // Primary: use phase labels when available
  let gf = matches.find((m) => m.phase === 'PLAYOFF_FINAL');
  let tp = matches.find((m) => m.phase === 'PLAYOFF_THIRD_PLACE');

  // Fallback: no phase labels (older tournaments) — derive from bracket structure.
  // Find the GF by the highest round across ALL matches (not just filled ones), so
  // an SF match with both player IDs doesn't get mistaken for the GF.
  if (!gf) {
    const maxRound = Math.max(...matches.map((m) => m.round), -Infinity);
    if (maxRound > -Infinity) {
      const finalRoundMatches = matches.filter((m) => m.round === maxRound);
      // The GF is the one without a loser next match (no consolation branch)
      gf = finalRoundMatches.find((m) => !m.loserNextMatchId) ?? finalRoundMatches[0];
      // Third-place is any other match in the same round
      const tpCandidate = finalRoundMatches.find((m) => m.matchId !== gf?.matchId);
      if (tpCandidate) tp = tpCandidate;
    }
  }

  if (gf) {
    // Only mark GF participants when both finalists are confirmed
    if (gf.player1Id && gf.player2Id) {
      gfParticipants.add(gf.player1Id);
      gfParticipants.add(gf.player2Id);
    }

    if (gf.status === 'COMPLETED' && gf.winnerId) {
      const loser = gf.player1Id === gf.winnerId ? gf.player2Id : gf.player1Id;
      placements.set(gf.winnerId, 1);
      if (loser) placements.set(loser, 2);
    }
  }

  if (tp) {
    if (tp.status === 'COMPLETED' && tp.winnerId) {
      const loser = tp.player1Id === tp.winnerId ? tp.player2Id : tp.player1Id;
      placements.set(tp.winnerId, 3);
      if (loser) placements.set(loser, 4);
    }
  }

  // For players not in top-4: track the round of their last completed match
  const lastCompletedRound = new Map<string, number>();
  for (const m of matches) {
    if (m.status !== 'COMPLETED' && m.status !== 'FORFEIT') continue;
    for (const pid of [m.player1Id, m.player2Id]) {
      if (!pid || placements.has(pid)) continue;
      const cur = lastCompletedRound.get(pid) ?? -1;
      if (m.round > cur) lastCompletedRound.set(pid, m.round);
    }
  }

  return { placements, lastCompletedRound, gfParticipants };
}

type Standing = SwissMeta['standings'][number];

/**
 * Re-sorts Swiss standings by playoff result so Grand Finalists always appear at
 * ranks 1–2 regardless of Swiss score.  Handles all three states:
 *   A) GF/TP not created yet → derive participants from completed SF results
 *   B) GF/TP exist, not yet played → group participants at the correct tier
 *   C) GF/TP completed → winner before loser
 */
export function sortStandingsByPlayoffResult(
  standings: Standing[],
  matches: BracketNode[],
): Standing[] {
  const gfMatch = matches.find((m) => m.phase === 'PLAYOFF_FINAL');
  const tpMatch = matches.find((m) => m.phase === 'PLAYOFF_THIRD_PLACE');
  const completedSFs = matches.filter(
    (m) => m.phase === 'PLAYOFF_SF' && m.status === 'COMPLETED' && m.winnerId,
  );

  if (!gfMatch && !tpMatch && completedSFs.length === 0) return standings;

  const order: string[] = [];
  const seen = new Set<string>();
  const add = (id: string | null) => {
    if (id && !seen.has(id)) { seen.add(id); order.push(id); }
  };

  // Ranks 1–2: Grand Final participants
  if (gfMatch?.status === 'COMPLETED' && gfMatch.winnerId) {
    const loser = gfMatch.player1Id === gfMatch.winnerId ? gfMatch.player2Id : gfMatch.player1Id;
    add(gfMatch.winnerId);
    add(loser);
  } else if (gfMatch) {
    add(gfMatch.player1Id);
    add(gfMatch.player2Id);
  } else {
    completedSFs.forEach((sf) => add(sf.winnerId));
  }

  // Ranks 3–4: 3rd-place participants
  if (tpMatch?.status === 'COMPLETED' && tpMatch.winnerId) {
    const loser = tpMatch.player1Id === tpMatch.winnerId ? tpMatch.player2Id : tpMatch.player1Id;
    add(tpMatch.winnerId);
    add(loser);
  } else if (tpMatch) {
    add(tpMatch.player1Id);
    add(tpMatch.player2Id);
  } else if (completedSFs.length > 0) {
    completedSFs.forEach((sf) => {
      const loser = sf.player1Id === sf.winnerId ? sf.player2Id : sf.player1Id;
      add(loser);
    });
  }

  if (order.length === 0) return standings;
  const orderedSet = new Set(order);
  const top = order
    .map((id) => standings.find((s) => s.userId === id))
    .filter((s): s is Standing => s != null);
  const rest = standings.filter((s) => !orderedSet.has(s.userId));
  return [...top, ...rest];
}

/**
 * Returns the IDs of every Grand / division final participant. Standard formats
 * have a single PLAYOFF_FINAL; Balanced Liechtenstein has one final per division,
 * so we collect the participants of ALL of them (not just the first).
 * Falls back to SF winners when no final match has been created yet, so the
 * "Advance to Grand Final" divider in SwissStandings highlights correctly.
 */
export function getFinalistIds(matches: BracketNode[]): Set<string> {
  const gfMatches = matches.filter((m) => m.phase === 'PLAYOFF_FINAL');
  if (gfMatches.length > 0) {
    const ids = new Set<string>();
    for (const gf of gfMatches) {
      if (gf.player1Id) ids.add(gf.player1Id);
      if (gf.player2Id) ids.add(gf.player2Id);
    }
    return ids;
  }
  const sfWinners = matches
    .filter((m) => m.phase === 'PLAYOFF_SF' && m.status === 'COMPLETED' && m.winnerId)
    .map((m) => m.winnerId)
    .filter((id): id is string => id !== null);
  return new Set(sfWinners);
}

/**
 * Returns the IDs of confirmed Semifinal qualifiers (QF winners).
 * Only meaningful for TOP8 format — for TOP4 the SF field is seeded directly.
 * Falls back to SF match participants when SF matches already exist.
 */
export function getSemifinalistIds(matches: BracketNode[]): Set<string> {
  // If SF matches already have players seeded, use those
  const sfPlayers = matches
    .filter((m) => m.phase === 'PLAYOFF_SF')
    .flatMap((m) => [m.player1Id, m.player2Id])
    .filter((id): id is string => id !== null);
  if (sfPlayers.length > 0) return new Set(sfPlayers);

  // Otherwise derive from completed QF matches
  const qfWinners = matches
    .filter((m) => m.phase === 'PLAYOFF_QF' && m.status === 'COMPLETED' && m.winnerId)
    .map((m) => m.winnerId)
    .filter((id): id is string => id !== null);
  return new Set(qfWinners);
}
