import type { BracketResponse, FactionDto } from '@rizzotto/types';
import { computeBracketLayout, MATCH_WIDTH, MATCH_HEIGHT, ROUND_GAP } from './computeBracketLayout';
import { MatchNode } from './MatchNode';

export interface BracketPlayerInfo {
  name: string;
  avatarUrl: string | null;
}

interface SVGBracketProps {
  data: BracketResponse;
  players?: Map<string, BracketPlayerInfo>;
  factionMap?: Map<string, FactionDto>;
  tournamentMode?: string;
  onMatchClick?: (matchId: string) => void;
}

export function SVGBracket({ data, players, factionMap, tournamentMode, onMatchClick }: SVGBracketProps) {
  const isSft = tournamentMode === 'SFT';
  const layout = computeBracketLayout(data.matches);

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
        if (!m.nextMatchId) return null;
        const from = layout.positions.get(m.matchId);
        const to = layout.positions.get(m.nextMatchId);
        if (!from || !to) return null;

        const startX = from.x + MATCH_WIDTH + PAD;
        const startY = from.y + MATCH_HEIGHT / 2 + PAD;
        const endX = to.x + PAD;
        const endY = to.y + MATCH_HEIGHT / 2 + PAD;
        const midX = startX + ROUND_GAP / 2;

        return (
          <path
            key={`conn-${m.matchId}`}
            d={`M ${startX} ${startY} H ${midX} V ${endY} H ${endX}`}
            stroke="#3a3a3a"
            strokeWidth="2"
            fill="none"
          />
        );
      })}

      {/* Loser-drop connector lines (dashed, dark-red) */}
      {data.matches.map((m) => {
        if (!m.loserNextMatchId) return null;
        const from = layout.positions.get(m.matchId);
        const to = layout.positions.get(m.loserNextMatchId);
        if (!from || !to) return null;

        const startX = from.x + MATCH_WIDTH / 2 + PAD;
        const startY = from.y + MATCH_HEIGHT + PAD;
        const endX = to.x + PAD;
        const endY = to.y + MATCH_HEIGHT / 2 + PAD;
        // Drop down then route horizontally to target
        const midY = startY + (endY - startY) / 2;

        return (
          <path
            key={`lose-${m.matchId}`}
            d={`M ${startX} ${startY} V ${midY} H ${endX} V ${endY}`}
            stroke="#7f1d1d"
            strokeWidth="2"
            strokeDasharray="5 3"
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

        return (
          <foreignObject
            key={m.matchId}
            x={pos.x + PAD}
            y={pos.y + PAD}
            width={MATCH_WIDTH}
            height={MATCH_HEIGHT}
          >
            {/* xmlns required for foreignObject HTML content */}
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
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
              />
            </div>
          </foreignObject>
        );
      })}
    </svg>
  );
}
