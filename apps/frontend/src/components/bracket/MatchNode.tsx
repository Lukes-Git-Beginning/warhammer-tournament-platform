import type { BracketNode } from '@tww3/types';

interface MatchNodeProps {
  match: BracketNode;
  player1Name?: string;
  player2Name?: string;
  onClick?: () => void;
}

export const statusColors: Record<string, string> = {
  ONGOING: 'border-green-600 bg-green-900/40',
  COMPLETED: 'border-stone-600 bg-stone-800/60',
  PENDING: 'border-stone-700 bg-stone-900/40',
  BYE: 'border-stone-800 bg-stone-900/30 opacity-60',
  FORFEIT: 'border-amber-700 bg-amber-950/40',
};

export function MatchNode({ match, player1Name, player2Name, onClick }: MatchNodeProps) {
  const isBye = match.status === 'BYE';
  const isOngoing = match.status === 'ONGOING';

  const statusCls = statusColors[match.status] ?? 'border-stone-700 bg-stone-900/40';

  // BYE uses dashed border style in addition to status colors
  const borderStyle = isBye ? 'border border-dashed' : 'border';

  const p1Winner = match.winnerId && match.winnerId === match.player1Id;
  const p2Winner = match.winnerId && match.winnerId === match.player2Id;

  const scoreParts = match.score ? match.score.split('-') : [];
  const score1 = scoreParts[0] ?? '';
  const score2 = scoreParts[1] ?? '';

  return (
    <div
      className={`w-full h-full ${borderStyle} ${statusCls} rounded flex flex-col overflow-hidden ${
        onClick ? 'cursor-pointer hover:border-warhammer-gold transition-colors' : ''
      } relative`}
      onClick={onClick}
    >
      {/* Player 1 row */}
      <div className="flex-1 flex items-center px-2 border-b border-stone-800">
        <span
          className={`flex-1 text-xs truncate ${
            p1Winner ? 'text-warhammer-gold font-semibold' : 'text-stone-300'
          }`}
        >
          {isBye ? 'BYE' : (player1Name ?? match.player1Id ?? '—')}
        </span>
        {score1 && (
          <span className={`text-xs ml-1 tabular-nums ${p1Winner ? 'text-warhammer-gold font-semibold' : 'text-stone-400'}`}>
            {score1}
          </span>
        )}
      </div>

      {/* Player 2 row */}
      <div className="flex-1 flex items-center px-2">
        <span
          className={`flex-1 text-xs truncate ${
            p2Winner ? 'text-warhammer-gold font-semibold' : 'text-stone-300'
          }`}
        >
          {isBye ? 'BYE' : (player2Name ?? match.player2Id ?? '—')}
        </span>
        {score2 && (
          <span className={`text-xs ml-1 tabular-nums ${p2Winner ? 'text-warhammer-gold font-semibold' : 'text-stone-400'}`}>
            {score2}
          </span>
        )}
      </div>

      {/* ONGOING indicator */}
      {isOngoing && (
        <span className="absolute bottom-1 left-1.5 w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
      )}
    </div>
  );
}
