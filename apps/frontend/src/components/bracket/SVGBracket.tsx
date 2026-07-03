import type { BracketNode, BracketResponse, FactionDto } from '@rizzotto/types';
import { computeBracketLayout, MATCH_WIDTH, MATCH_HEIGHT, ROUND_GAP } from './computeBracketLayout';
import { MatchNode } from './MatchNode';

// Playoff phases that feed into each other (used when next_match_id is null in the DB).
const PHASE_FEEDS_INTO: Record<string, string> = {
  PLAYOFF_QF: 'PLAYOFF_SF',
  PLAYOFF_SF: 'PLAYOFF_FINAL',
};

function resolveNextMatchId(m: BracketNode, allMatches: BracketNode[]): string | null {
  if (m.nextMatchId) return m.nextMatchId;
  if (!m.phase || !PHASE_FEEDS_INTO[m.phase]) return null;
  const targetPhase = PHASE_FEEDS_INTO[m.phase];
  const next = allMatches.find(
    (t) => t.phase === targetPhase && t.matchNumber === Math.ceil(m.matchNumber / 2),
  );
  return next?.matchId ?? null;
}

export interface BracketPlayerInfo {
  name: string;
  avatarUrl: string | null;
}

interface SVGBracketProps {
  data: BracketResponse;
  players?: Map<string, BracketPlayerInfo>;
  factionMap?: Map<string, FactionDto>;
  tournamentMode?: string;
  /** Tournament format (e.g. 'BALANCED_LIECHTENSTEIN') — distinct from match mode */
  format?: string;
  /** userId → skillBand (1..5) — present for BALANCED_LIECHTENSTEIN */
  bandByUser?: Map<string, number>;
  onMatchClick?: (matchId: string) => void;
}

/**
 * Returns a slot label for an undecided bracket slot.
 * - Completed feeder + loserSlot  → shows the loser's name (single name, confirmed)
 * - Completed feeder + winnerSlot → shows the winner's name (single name, confirmed)
 * - Pending feeder with 2 players → "P1 / P2" (exactly 2 candidates)
 * - Pending feeder with 1 player  → that player's name
 * - Pending feeder with 0 players → null → MatchNode shows "TBD"
 */
export function makeSlotLabel(
  feeder: BracketNode,
  players?: Map<string, BracketPlayerInfo>,
  isLoserSlot = false,
): string | null {
  const p1Name = feeder.player1Id ? (players?.get(feeder.player1Id)?.name ?? null) : null;
  const p2Name = feeder.player2Id ? (players?.get(feeder.player2Id)?.name ?? null) : null;

  if ((feeder.status === 'COMPLETED' || feeder.status === 'FORFEIT') && feeder.winnerId) {
    if (isLoserSlot) {
      const loserId = feeder.player1Id === feeder.winnerId ? feeder.player2Id : feeder.player1Id;
      return loserId ? (players?.get(loserId)?.name ?? null) : null;
    }
    return players?.get(feeder.winnerId)?.name ?? null;
  }

  // Feeder not yet decided — project the candidate pair. Mark loser-path slots
  // ("Loser of …") so the third-place match doesn't render the identical pair as
  // the Grand Final (whose slots are the *winners* of the very same feeders).
  const candidates =
    p1Name && p2Name ? `${p1Name} / ${p2Name}` : p1Name ? `${p1Name} / TBD` : p2Name ? `${p2Name} / TBD` : null;
  if (!candidates) return null; // feeder has no known players yet → show TBD
  return isLoserSlot ? `Loser of ${candidates}` : candidates;
}

/**
 * Compute the projected labels ("P1 / P2", "Winner of …", "Loser of …") for every
 * match slot that has no concrete player yet, so future rounds preview their
 * candidates instead of showing "TBD"/"BYE". Feeders are matched by nextMatchId
 * (winner path) and loserNextMatchId (loser path), falling back to round/matchNumber
 * arithmetic when next_match_id is null in the DB.
 *
 * A feeder whose decided result already occupies a slot of the target is dropped, so
 * a half-filled target (one semifinal done, the other still pending) projects the
 * *other* feeder into its empty slot rather than duplicating the player already seated.
 */
export function computeSlotLabels(
  matches: BracketNode[],
  players?: Map<string, BracketPlayerInfo>,
): Map<string, { p1: string | null; p2: string | null }> {
  const slotLabels = new Map<string, { p1: string | null; p2: string | null }>();
  for (const target of matches) {
    if (target.player1Id !== null && target.player2Id !== null) continue;
    // Include both winner-path feeders (nextMatchId) and loser-path feeders (loserNextMatchId)
    const feeders = matches
      .filter((f) =>
        resolveNextMatchId(f, matches) === target.matchId ||
        f.loserNextMatchId === target.matchId,
      )
      .sort((a, b) => a.matchNumber - b.matchNumber);
    const isLoserFeeder = (f: BracketNode) => f.loserNextMatchId === target.matchId;

    // A decided feeder delivers exactly one player to this target: its winner, or
    // its loser for a loser-path feeder (third-place). Drop feeders whose delivered
    // player already sits in a slot — otherwise a feeder that has already advanced
    // (e.g. SF2 when only SF1 is still pending) gets projected a second time into
    // the remaining empty slot, duplicating the player already shown there.
    const deliveredId = (f: BracketNode): string | null => {
      if ((f.status === 'COMPLETED' || f.status === 'FORFEIT') && f.winnerId) {
        if (isLoserFeeder(f)) return f.player1Id === f.winnerId ? f.player2Id : f.player1Id;
        return f.winnerId;
      }
      return null; // undecided feeder — cannot be "already consumed"
    };
    const occupied = new Set(
      [target.player1Id, target.player2Id].filter((id): id is string => id !== null),
    );
    const pending = feeders.filter((f) => {
      const id = deliveredId(f);
      return id === null || !occupied.has(id);
    });

    // Assign the still-pending feeders to the empty slots in order, so a half-filled
    // target projects the *other* feeder rather than the one already seated.
    const labels: { p1: string | null; p2: string | null } = { p1: null, p2: null };
    const emptySlots: ('p1' | 'p2')[] = [];
    if (target.player1Id === null) emptySlots.push('p1');
    if (target.player2Id === null) emptySlots.push('p2');
    emptySlots.forEach((slot, idx) => {
      const f = pending[idx];
      if (f) labels[slot] = makeSlotLabel(f, players, isLoserFeeder(f));
    });
    slotLabels.set(target.matchId, labels);
  }
  return slotLabels;
}

export function SVGBracket({ data, players, factionMap, tournamentMode, format, bandByUser, onMatchClick }: SVGBracketProps) {
  const isSft = tournamentMode === 'SFT';
  const layout = computeBracketLayout(data.matches);

  const slotLabels = computeSlotLabels(data.matches, players);

  // Add padding so connectors and labels don't clip
  const PAD = 20;
  const svgWidth = layout.width + PAD * 2;
  const svgHeight = layout.height + PAD * 2;

  return (
    <svg
      width={svgWidth}
      height={svgHeight}
      xmlns="http://www.w3.org/2000/svg"
      className="select-none"
    >
      {/* Winner-progression connector lines (behind match nodes) */}
      {data.matches.map((m) => {
        const effectiveNextId = resolveNextMatchId(m, data.matches);
        if (!effectiveNextId) return null;
        const from = layout.positions.get(m.matchId);
        const to = layout.positions.get(effectiveNextId);
        if (!from || !to) return null;

        const startX = from.x + MATCH_WIDTH + PAD;
        const startY = from.y + MATCH_HEIGHT / 2 + PAD;
        const endX = to.x + PAD;
        const endY = to.y + MATCH_HEIGHT / 2 + PAD;
        const midX = startX + ROUND_GAP / 2;

        return (
          <path
            key={`conn-${m.matchId}-${effectiveNextId}`}
            d={`M ${startX} ${startY} H ${midX} V ${endY} H ${endX}`}
            stroke="#3a3a3a"
            strokeWidth="2"
            fill="none"
          />
        );
      })}


      {/* Match nodes as foreignObjects */}
      {data.matches.map((m) => {
        const pos = layout.positions.get(m.matchId);
        if (!pos) return null;

        const p1 = m.player1Id ? players?.get(m.player1Id) : undefined;
        const p2 = m.player2Id ? players?.get(m.player2Id) : undefined;
        const f1 = m.player1FactionId ? factionMap?.get(m.player1FactionId) : undefined;
        const f2 = m.player2FactionId ? factionMap?.get(m.player2FactionId) : undefined;
        // Show faction logo for SFT (fixed faction per event) or BPT Bo1 (single game → faction is unambiguous).
        const showFaction = isSft || m.matchFormat === 'BO1';
        const labels = slotLabels.get(m.matchId);
        const p1Band = m.player1Id ? bandByUser?.get(m.player1Id) : undefined;
        const p2Band = m.player2Id ? bandByUser?.get(m.player2Id) : undefined;

        return (
          <foreignObject
            key={m.matchId}
            x={pos.x + PAD}
            y={pos.y + PAD}
            width={MATCH_WIDTH}
            height={MATCH_HEIGHT}
          >
            {/* xmlns required for foreignObject HTML content */}
            { }
          <div {...({ xmlns: 'http://www.w3.org/1999/xhtml' } as any)} style={{ width: '100%', height: '100%' }}>
              <MatchNode
                match={m}
                player1Name={p1?.name}
                player2Name={p2?.name}
                player1AvatarUrl={p1?.avatarUrl}
                player2AvatarUrl={p2?.avatarUrl}
                player1Faction={f1}
                player2Faction={f2}
                showFaction={showFaction}
                onClick={onMatchClick ? () => onMatchClick(m.matchId) : undefined}
                p1SlotLabel={labels?.p1}
                p2SlotLabel={labels?.p2}
                tournamentMode={format}
                player1Band={p1Band}
                player2Band={p2Band}
              />
            </div>
          </foreignObject>
        );
      })}
    </svg>
  );
}
