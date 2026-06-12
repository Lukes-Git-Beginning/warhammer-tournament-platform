import type { BracketNode, FactionDto } from '@rizzotto/types';

interface MatchNodeProps {
  match: BracketNode;
  player1Name?: string;
  player2Name?: string;
  player1AvatarUrl?: string | null;
  player2AvatarUrl?: string | null;
  player1Faction?: FactionDto | null;
  player2Faction?: FactionDto | null;
  showFaction?: boolean;
  onClick?: () => void;
  /** Label shown in slot 1 when player is not yet determined (e.g. "Grombrindal / Louen") */
  p1SlotLabel?: string | null;
  /** Label shown in slot 2 when player is not yet determined */
  p2SlotLabel?: string | null;
}

/** Tiny avatar with initials fallback, sized for the cramped match node rows. */
function PlayerAvatar({ name, avatarUrl }: { name?: string; avatarUrl?: string | null }) {
  if (!name) return null;
  return avatarUrl ? (
    <img
      src={avatarUrl}
      alt=""
      className="mr-1 h-4 w-4 shrink-0 rounded-full object-cover"
      loading="lazy"
      draggable={false}
    />
  ) : (
    <span className="mr-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-stone-700 text-[8px] font-semibold text-stone-300">
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

/** Tiny faction icon (16×16) for use inside the cramped bracket node rows. */
function FactionIndicator({ faction }: { faction?: FactionDto | null }) {
  if (!faction) return null;
  return faction.icon_url ? (
    <img
      src={faction.icon_url}
      alt=""
      title={faction.name}
      className="ml-2 h-4 w-4 shrink-0 rounded-sm object-contain"
      style={{ backgroundColor: '#837a6f' }}
      loading="lazy"
      draggable={false}
    />
  ) : (
    <span
      title={faction.name}
      className="ml-2 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-[7px] font-bold text-white"
      style={{ backgroundColor: faction.color_hex }}
    >
      {faction.initials}
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
  player1Faction,
  player2Faction,
  showFaction = false,
  onClick,
  p1SlotLabel,
  p2SlotLabel,
}: MatchNodeProps) {
  const isBye = match.status === 'BYE';
  const isOngoing = match.status === 'ONGOING';

  const statusCls = statusColors[match.status] ?? 'border-stone-700 bg-stone-900/40';

  // BYE uses dashed border style in addition to status colors
  const borderStyle = isBye ? 'border border-dashed' : 'border';

  const p1Winner = match.winnerId && match.winnerId === match.player1Id;
  const p2Winner = match.winnerId && match.winnerId === match.player2Id;

  // Use game wins if available, fall back to legacy score string
  const score1 =
    match.player1GameWins > 0 || match.player2GameWins > 0
      ? String(match.player1GameWins)
      : (match.score ? (match.score.split('-')[0] ?? '') : '');
  const score2 =
    match.player1GameWins > 0 || match.player2GameWins > 0
      ? String(match.player2GameWins)
      : (match.score ? (match.score.split('-')[1] ?? '') : '');

  const isThirdPlace = match.phase === 'PLAYOFF_THIRD_PLACE';
  const isGrandFinal = match.phase === 'PLAYOFF_FINAL';
  const isSemiFinal  = match.phase === 'PLAYOFF_SF';

  const outlineCls = isGrandFinal
    ? 'border-2 border-rizzotto-gold-500/70 bg-rizzotto-gold-500/5'
    : isSemiFinal
      ? 'border-2 border-rizzotto-stone-400/60 bg-rizzotto-stone-400/5'
      : `${borderStyle} ${statusCls}`;

  const hoverCls = onClick
    ? `cursor-pointer transition-colors ${
        isGrandFinal ? 'hover:border-rizzotto-gold-500'
        : isSemiFinal ? 'hover:border-rizzotto-stone-300'
        : 'hover:border-stone-500'
      }`
    : '';

  return (
    <div
      className={`w-full h-full ${outlineCls} rounded flex flex-col overflow-hidden ${hoverCls} relative`}
      onClick={onClick}
    >
      {isGrandFinal && (
        <div className="absolute top-0 right-0 bg-rizzotto-gold-500/20 text-rizzotto-gold-400 text-[8px] font-bold uppercase tracking-wider px-1 rounded-bl border-l border-b border-rizzotto-gold-500/40">
          Grand Final
        </div>
      )}
      {isSemiFinal && (
        <div className="absolute top-0 right-0 bg-rizzotto-stone-400/15 text-rizzotto-stone-300 text-[8px] font-bold uppercase tracking-wider px-1 rounded-bl border-l border-b border-rizzotto-stone-400/40">
          Semi Final
        </div>
      )}
      {isThirdPlace && (
        <div className="absolute top-0 right-0 bg-amber-950/90 text-orange-600 text-[8px] font-bold uppercase tracking-wider px-1 rounded-bl border-l border-b border-amber-700/40">
          3rd Place
        </div>
      )}
      {/* Player 1 row */}
      <div className="flex-1 flex items-center px-2 border-b border-stone-800">
        {match.player1Id && <PlayerAvatar name={player1Name} avatarUrl={player1AvatarUrl} />}
        <span
          className={`flex-1 text-xs truncate ${
            p1Winner
              ? 'text-rizzotto-gold-500 font-semibold'
              : match.player1Id
                ? 'text-stone-300'
                : 'text-stone-500 italic'
          }`}
        >
          {match.player1Id
            ? (player1Name ?? match.player1Id)
            : (p1SlotLabel ?? (isBye ? 'BYE' : 'TBD'))}
        </span>
        {showFaction && match.player1Id && <FactionIndicator faction={player1Faction} />}
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
        {match.player2Id && <PlayerAvatar name={player2Name} avatarUrl={player2AvatarUrl} />}
        <span
          className={`flex-1 text-xs truncate ${
            p2Winner
              ? 'text-rizzotto-gold-500 font-semibold'
              : match.player2Id
                ? 'text-stone-300'
                : 'text-stone-500 italic'
          }`}
        >
          {match.player2Id
            ? (player2Name ?? match.player2Id)
            : (p2SlotLabel ?? (isBye ? 'BYE' : 'TBD'))}
        </span>
        {showFaction && match.player2Id && <FactionIndicator faction={player2Faction} />}
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
