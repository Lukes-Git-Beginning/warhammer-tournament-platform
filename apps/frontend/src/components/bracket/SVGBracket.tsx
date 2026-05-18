import type { BracketResponse } from '@rizzotto/types';
import { computeBracketLayout, MATCH_WIDTH, MATCH_HEIGHT, ROUND_GAP } from './computeBracketLayout';
import { MatchNode } from './MatchNode';

interface SVGBracketProps {
  data: BracketResponse;
  playerNameMap?: Map<string, string>;
  onMatchClick?: (matchId: string) => void;
}

export function SVGBracket({ data, playerNameMap, onMatchClick }: SVGBracketProps) {
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
      {/* Connector lines first (behind match nodes) */}
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

      {/* Match nodes as foreignObjects */}
      {data.matches.map((m) => {
        const pos = layout.positions.get(m.matchId);
        if (!pos) return null;

        const p1Name = m.player1Id ? (playerNameMap?.get(m.player1Id) ?? undefined) : undefined;
        const p2Name = m.player2Id ? (playerNameMap?.get(m.player2Id) ?? undefined) : undefined;

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
                player1Name={p1Name}
                player2Name={p2Name}
                onClick={onMatchClick ? () => onMatchClick(m.matchId) : undefined}
              />
            </div>
          </foreignObject>
        );
      })}
    </svg>
  );
}
