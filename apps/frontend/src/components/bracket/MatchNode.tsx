import type { BracketNode } from '@rizzotto/types';

interface MatchNodeProps {
  match: BracketNode;
  player1Name?: string;
  player2Name?: string;
  player1AvatarUrl?: string | null;
  player2AvatarUrl?: string | null;
  onClick?: () => void;
}

/** Tiny avatar with initials fallback, sized for the cramped match node rows. */
function PlayerAvatar({ name, avatarUrl }: { name?: string; avatarUrl?: string | null }) {
  if (!name) return null;
  return avatarUrl ? (
    <img
      src={avatarUrl}
      alt=""
      className="mr-1.5 h-4 w-4 shrink-0 rounded-full object-cover"
      loading="lazy"
      draggable={false}
    />
  ) : (
    <span className="mr-1.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-stone-700 text-[8px] font-semibold text-stone-300">
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

export const statusColors: Record<string, string> = {
  ONGOING: 'border-green-600 bg-green-900/40',
  COMPLETED: 'border-stone-600 bg-stone-800/60',
  PENDING: 'border-stone-700 bg-stone-900/40',
  BYE: 'border-stone-800 bg-stone-900/30 opacity-60',
  FORFEIT: 'border-amber-700 bg-amber-950/40',
};

export function MatchNode({
  match,
  player1Name,
  player2Name,
  player1AvatarUrl,
  player2AvatarUrl,
  onClick,
}: MatchNodeProps) {
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
        onClick ? 'cursor-pointer hover:border-rizzotto-gold-500 transition-colors' : ''
      } relative`}
      onClick={onClick}
    >
      {/* Player 1 row */}
      <div className="flex-1 flex items-center px-2 border-b border-stone-800">
        {!isBye && <PlayerAvatar name={player1Name} avatarUrl={player1AvatarUrl} />}
        <span
          className={`flex-1 text-xs truncate ${
            p1Winner ? 'text-rizzotto-gold-500 font-semibold' : 'text-stone-300'
          }`}
        >
          {isBye ? 'BYE' : (player1Name ?? match.player1Id ?? '—')}
        </span>
        {score1 && (
          <span
            className={`text-xs ml-1 tabular-nums ${p1Winner ? 'text-rizzotto-gold-500 font-semibold' : 'text-stone-400'}`}
          >
            {score1}
          </span>
        )}
      </div>

      {/* Player 2 row */}
      <div className="flex-1 flex items-center px-2">
        {!isBye && <PlayerAvatar name={player2Name} avatarUrl={player2AvatarUrl} />}
        <span
          className={`flex-1 text-xs truncate ${
            p2Winner ? 'text-rizzotto-gold-500 font-semibold' : 'text-stone-300'
          }`}
        >
          {isBye ? 'BYE' : (player2Name ?? match.player2Id ?? '—')}
        </span>
        {score2 && (
          <span
            className={`text-xs ml-1 tabular-nums ${p2Winner ? 'text-rizzotto-gold-500 font-semibold' : 'text-stone-400'}`}
          >
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
