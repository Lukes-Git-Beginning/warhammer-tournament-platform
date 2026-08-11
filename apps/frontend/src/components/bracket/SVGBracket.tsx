import type React from 'react';
import type { BracketNode, BracketResponse, FactionDto, ProjectedDivision } from '@rizzotto/types';
import { computeBracketLayout, computePlaceholderLayout, MATCH_WIDTH, MATCH_HEIGHT, ROUND_GAP } from './computeBracketLayout';
import { MatchNode } from './MatchNode';
import { SKILL_BAND_META } from './skillBandMeta';

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
  /**
   * Projected playoff divisions (from swiss.plan) — rendered as greyed TBD placeholders
   * inside the bracket when the real playoffs have not been generated yet.
   * When undefined or empty, no placeholders are shown.
   */
  projectedDivisions?: ProjectedDivision[];
  /**
   * Whether the tournament has a 3rd-place match enabled — drives placeholder shape.
   * Ignored when projectedDivisions is not set.
   */
  hasThirdPlaceMatch?: boolean;
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

export function SVGBracket({ data, players, factionMap, tournamentMode, format, bandByUser, onMatchClick, projectedDivisions, hasThirdPlaceMatch }: SVGBracketProps) {
  const isSft = tournamentMode === 'SFT';
  const is2d3 = tournamentMode === 'TWO_D_THREE';
  const layout = computeBracketLayout(data.matches, bandByUser);

  const slotLabels = computeSlotLabels(data.matches, players);

  // Compute placeholder layout when projected divisions are provided.
  // xBase is shifted right of the existing swiss matches so placeholders appear
  // in the bracket area (to the right of the group-phase matches).
  const showPlaceholders =
    (projectedDivisions?.filter((d) => d.format !== 'NONE' && d.size >= 2).length ?? 0) > 0;
  const placeholderXBase = layout.width > 0 ? layout.width + ROUND_GAP : 0;
  const placeholderLayout = showPlaceholders
    ? computePlaceholderLayout(
        projectedDivisions!,
        hasThirdPlaceMatch ?? false,
        placeholderXBase,
      )
    : null;

  // Add padding so connectors and labels don't clip
  const PAD = 20;
  const totalWidth = placeholderLayout
    ? Math.max(layout.width, placeholderXBase + placeholderLayout.width)
    : layout.width;
  const totalHeight = placeholderLayout
    ? Math.max(layout.height, placeholderLayout.height)
    : layout.height;
  const svgWidth = totalWidth + PAD * 2;
  const svgHeight = totalHeight + PAD * 2;

  return (
    <svg
      width={svgWidth}
      height={svgHeight}
      xmlns="http://www.w3.org/2000/svg"
      className="select-none"
    >
      {/* Winner-progression connector lines for real matches (behind match nodes) */}
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

      {/* Connector lines between placeholder nodes */}
      {placeholderLayout?.nodes.map((n) => {
        const from = placeholderLayout.positions.get(n.id);
        if (!from) return null;
        const lines: React.ReactNode[] = [];

        if (n.nextId) {
          const to = placeholderLayout.positions.get(n.nextId);
          if (to) {
            const startX = from.x + MATCH_WIDTH + PAD;
            const startY = from.y + MATCH_HEIGHT / 2 + PAD;
            const endX = to.x + PAD;
            const endY = to.y + MATCH_HEIGHT / 2 + PAD;
            const midX = startX + ROUND_GAP / 2;
            lines.push(
              <path
                key={`ph-conn-${n.id}-next`}
                d={`M ${startX} ${startY} H ${midX} V ${endY} H ${endX}`}
                stroke="#2a2a2a"
                strokeWidth="1.5"
                strokeDasharray="4 3"
                fill="none"
              />
            );
          }
        }

        if (n.loserNextId) {
          const to = placeholderLayout.positions.get(n.loserNextId);
          if (to) {
            const startX = from.x + MATCH_WIDTH + PAD;
            const startY = from.y + MATCH_HEIGHT * 0.75 + PAD;
            const endX = to.x + PAD;
            const endY = to.y + MATCH_HEIGHT / 2 + PAD;
            const midX = startX + ROUND_GAP / 2;
            lines.push(
              <path
                key={`ph-conn-${n.id}-loser`}
                d={`M ${startX} ${startY} H ${midX} V ${endY} H ${endX}`}
                stroke="#222"
                strokeWidth="1.5"
                strokeDasharray="4 3"
                fill="none"
              />
            );
          }
        }

        return lines;
      })}

      {/* Division band labels — one per stacked Balanced division bracket */}
      {layout.groups?.map((g, i) => {
        // The division is named after the highest band among its players.
        let band = 0;
        for (const mid of g.matchIds) {
          const m = data.matches.find((x) => x.matchId === mid);
          for (const pid of [m?.player1Id, m?.player2Id]) {
            const b = pid ? bandByUser?.get(pid) : undefined;
            if (b && b > band) band = b;
          }
        }
        const meta = band ? SKILL_BAND_META[band] : null;
        return (
          <foreignObject key={`grp-${i}`} x={g.x + PAD} y={g.y + PAD} width={MATCH_WIDTH * 2} height={28}>
            { }
            <div {...({ xmlns: 'http://www.w3.org/1999/xhtml' } as any)} style={{ width: '100%', height: '100%' }}>
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full shrink-0 ${meta?.dotCls ?? 'bg-stone-500'}`} />
                <span className={`text-xs font-bold uppercase tracking-widest ${meta?.textCls ?? 'text-stone-400'}`}>
                  {meta?.name ?? 'Division'} Division
                </span>
              </div>
            </div>
          </foreignObject>
        );
      })}

      {/* Placeholder division group labels */}
      {placeholderLayout?.groups.map((g, i) => (
        <foreignObject key={`ph-grp-${i}`} x={g.x + PAD} y={g.y + PAD} width={MATCH_WIDTH * 3} height={28}>
          { }
          <div {...({ xmlns: 'http://www.w3.org/1999/xhtml' } as any)} style={{ width: '100%', height: '100%' }}>
            <div className="flex items-center gap-2">
              {g.label && (
                <span className="text-xs font-medium text-stone-500 uppercase tracking-wider">{g.label}</span>
              )}
              <span className="text-[10px] text-stone-600 italic">{g.detail} · projected</span>
            </div>
          </div>
        </foreignObject>
      ))}

      {/* Match nodes as foreignObjects */}
      {data.matches.map((m) => {
        const pos = layout.positions.get(m.matchId);
        if (!pos) return null;

        const p1 = m.player1Id ? players?.get(m.player1Id) : undefined;
        const p2 = m.player2Id ? players?.get(m.player2Id) : undefined;
        const f1 = m.player1FactionId ? factionMap?.get(m.player1FactionId) : undefined;
        const f2 = m.player2FactionId ? factionMap?.get(m.player2FactionId) : undefined;
        // Show faction logo for SFT (fixed faction per event), 2D3 (drawn per game at creation),
        // or Bo1 (single game → faction is unambiguous).
        const showFaction = isSft || is2d3 || m.matchFormat === 'BO1';
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

      {/* Placeholder match nodes (projected, pre-generated playoffs) */}
      {placeholderLayout?.nodes.map((n) => {
        const pos = placeholderLayout.positions.get(n.id);
        if (!pos) return null;
        const isThirdPlace = n.phase === '3rd Place';
        const isFinal = n.phase === 'Final';
        const isSF = n.phase === 'SF';

        return (
          <foreignObject
            key={n.id}
            x={pos.x + PAD}
            y={pos.y + PAD}
            width={MATCH_WIDTH}
            height={MATCH_HEIGHT}
          >
            { }
            <div {...({ xmlns: 'http://www.w3.org/1999/xhtml' } as any)} style={{ width: '100%', height: '100%' }}>
              <PlaceholderMatchNode phase={n.phase} isFinal={isFinal} isSF={isSF} isThirdPlace={isThirdPlace} />
            </div>
          </foreignObject>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Placeholder match node
// ---------------------------------------------------------------------------

interface PlaceholderMatchNodeProps {
  phase: 'QF' | 'SF' | 'Final' | '3rd Place';
  isFinal: boolean;
  isSF: boolean;
  isThirdPlace: boolean;
}

const PHASE_LABEL: Record<string, string> = {
  QF: 'Quarterfinal',
  SF: 'Semifinal',
  Final: 'Final',
  '3rd Place': '3rd Place',
};

/**
 * A greyed-out, dashed-border placeholder match node for a not-yet-generated playoff slot.
 * Reuses the same 80×200 dimensions as real MatchNode so it fits the SVG layout grid.
 */
function PlaceholderMatchNode({ phase, isFinal, isSF, isThirdPlace }: PlaceholderMatchNodeProps) {
  const borderCls = isFinal
    ? 'border-2 border-dashed border-rizzotto-gold-500/25'
    : isSF
      ? 'border-2 border-dashed border-stone-500/30'
      : 'border border-dashed border-stone-700/50';

  const badgeCls = isFinal
    ? 'bg-rizzotto-gold-500/10 text-rizzotto-gold-500/50 border-rizzotto-gold-500/20'
    : isThirdPlace
      ? 'bg-amber-950/50 text-orange-700/70 border-amber-800/20'
      : isSF
        ? 'bg-stone-800/50 text-stone-500/70 border-stone-600/20'
        : 'bg-stone-900/40 text-stone-600 border-stone-700/20';

  return (
    <div
      className={`w-full h-full ${borderCls} rounded flex flex-col overflow-hidden opacity-60 bg-stone-950/30`}
    >
      {/* Phase badge */}
      <div
        className={`absolute top-0 right-0 text-[8px] font-bold uppercase tracking-wider px-1 rounded-bl border-l border-b ${badgeCls}`}
        style={{ position: 'absolute' }}
      >
        {PHASE_LABEL[phase] ?? phase}
      </div>
      {/* Player 1 slot */}
      <div className="flex-1 flex items-center px-2 border-b border-stone-800/50">
        <span className="flex-1 text-xs italic text-stone-600">TBD</span>
      </div>
      {/* Player 2 slot */}
      <div className="flex-1 flex items-center px-2">
        <span className="flex-1 text-xs italic text-stone-600">TBD</span>
      </div>
    </div>
  );
}
