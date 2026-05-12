import type { BracketNode } from '@tww3/types';

interface MatchNodeProps {
  match: BracketNode;
  player1Name?: string;
  player2Name?: string;
  onClick?: () => void;
}

export function MatchNode({ match, player1Name, player2Name, onClick }: MatchNodeProps) {
  const isBye = match.status === 'BYE';
  const isOngoing = match.status === 'ONGOING';

  const borderClass = isBye
    ? 'border border-dashed border-stone-600'
    : 'border border-stone-700';

  const p1Winner = match.winnerId && match.winnerId === match.player1Id;
  const p2Winner = match.winnerId && match.winnerId === match.player2Id;

  const scoreParts = match.score ? match.score.split('-') : [];
  const score1 = scoreParts[0] ?? '';
  const score2 = scoreParts[1] ?? '';

  return (
    <div
      className={`w-full h-full bg-stone-900 ${borderClass} rounded flex flex-col overflow-hidden ${
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
