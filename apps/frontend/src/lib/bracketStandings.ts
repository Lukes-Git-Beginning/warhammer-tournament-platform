import type { BracketNode, SwissMeta } from '@rizzotto/types';

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
 * Returns the IDs of the two Grand Final participants.
 * Falls back to SF winners when the GF match hasn't been created yet, so the
 * "Advance to Grand Final" divider in SwissStandings highlights correctly.
 */
export function getFinalistIds(matches: BracketNode[]): Set<string> {
  const gfMatch = matches.find((m) => m.phase === 'PLAYOFF_FINAL');
  if (gfMatch) {
    return new Set(
      [gfMatch.player1Id, gfMatch.player2Id].filter((id): id is string => id !== null),
    );
  }
  const sfWinners = matches
    .filter((m) => m.phase === 'PLAYOFF_SF' && m.status === 'COMPLETED' && m.winnerId)
    .map((m) => m.winnerId)
    .filter((id): id is string => id !== null);
  return new Set(sfWinners);
}
