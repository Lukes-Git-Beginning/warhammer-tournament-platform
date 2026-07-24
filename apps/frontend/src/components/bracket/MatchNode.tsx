import type { BracketNode, FactionDto } from '@rizzotto/types';
import { SKILL_BAND_META } from './skillBandMeta.js';

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
  /** Tournament format — used to customise phase labels (e.g. "Division Final" for BALANCED_LIECHTENSTEIN) */
  tournamentMode?: string;
  /** Skill band (1..5) for player 1 — BALANCED_LIECHTENSTEIN only */
  player1Band?: number;
  /** Skill band (1..5) for player 2 — BALANCED_LIECHTENSTEIN only */
  player2Band?: number;
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

/**
 * Coloured dot indicating a player's skill band in BALANCED_LIECHTENSTEIN matches.
 * Shows a small filled circle in the band colour with a tooltip.
 */
function BandDot({ band }: { band: number }) {
  const meta = SKILL_BAND_META[band];
  if (!meta) return null;
  return (
    <span
      title={`${meta.name} division`}
      className={`ml-1 inline-block h-2 w-2 shrink-0 rounded-full ${meta.dotCls}`}
    />
  );
}

/**
 * Upward arrows shown next to the lower-band player in a cross-band match.
 * N = (higher band − lower band); arrow count visualises the gap magnitude.
 */
function UpArrows({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="ml-1 shrink-0 text-[9px] text-stone-400 leading-none"
      title={`${count} band${count > 1 ? 's' : ''} underdog`}
    >
      {'↑'.repeat(count)}
    </span>
  );
}

export const statusColors: Record<string, string> = {
  ONGOING:     'border-green-600 bg-green-900/40',
  COMPLETED:   'border-stone-600 bg-stone-800/60',
  PENDING:     'border-stone-700 bg-stone-900/40',
  BYE:         'border-stone-800 bg-stone-900/30 opacity-60',
  FORFEIT:     'border-amber-700 bg-amber-950/40',
  CANCELLED:   'border-stone-700 bg-stone-900/20 opacity-50',
  CATCHUP_BYE: 'border-stone-800 bg-stone-900/20 opacity-50',
  PENDING_BYE: 'border-stone-800 bg-stone-900/20 opacity-50',
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
  tournamentMode,
  player1Band,
  player2Band,
}: MatchNodeProps) {
  const isBye = match.status === 'BYE';
  // PENDING_BYE is a normal PROVISIONAL bye (BaLi 2.0): a player held for a possible same-depth
  // opponent. It scores like a real bye once it resolves (or becomes a match), so it must NOT
  // read as a 0-point catch-up bye. CATCHUP_BYE is the only true 0-point late-join placeholder.
  const isPendingBye = match.status === 'PENDING_BYE';
  const isCatchupBye = match.status === 'CATCHUP_BYE';
  const isAnyBye = isBye || isPendingBye || isCatchupBye;
  const isForfeit = match.status === 'FORFEIT';
  const isCancelled = match.status === 'CANCELLED';
  const isOngoing = match.status === 'ONGOING';
  // A void-cancelled node: one player withdrew and the survivor was re-paired.
  // Distinct from double-drop CANCELLED (where withdrawnPlayerId is not set).
  const isWithdrawnVoid = isCancelled && !!match.withdrawnPlayerId;
  // FORFEIT: non-winner is the dropped player
  // CANCELLED (plain double-drop): both players dropped — treat both slots as dropped
  // CANCELLED (void via withdrawal): only the withdrawn player is dropped; the survivor was re-paired
  const droppedPlayerId = isForfeit && match.winnerId
    ? (match.winnerId === match.player1Id ? match.player2Id : match.player1Id)
    : isWithdrawnVoid && match.withdrawnPlayerId
      ? match.withdrawnPlayerId
      : null;
  const bothDropped = isCancelled && !match.withdrawnPlayerId;
  // A slot is only "dropped" when it actually holds a player. Without the
  // null check, an empty/TBD slot (player1Id === null) matches droppedPlayerId
  // (also null) and a pending future-round node renders struck-through "OUT".
  const p1Dropped = match.player1Id !== null && (bothDropped || droppedPlayerId === match.player1Id);
  const p2Dropped = match.player2Id !== null && (bothDropped || droppedPlayerId === match.player2Id);

  const statusCls = statusColors[match.status] ?? 'border-stone-700 bg-stone-900/40';

  // Every bye variant uses a dashed border in addition to status colors
  const borderStyle = isAnyBye ? 'border border-dashed' : 'border';

  const p1Winner = match.winnerId && match.winnerId === match.player1Id;
  const p2Winner = match.winnerId && match.winnerId === match.player2Id;

  const isDraw = match.result === 'DRAW';

  // Show per-game wins whenever any exist — a played 1–1 (e.g. a Bo2 draw) reads as "1–1",
  // not "½–½". "½" is reserved for a true couldn't-play draw with no games. Falls back to
  // the legacy score string when neither is present.
  const hasGameWins = match.player1GameWins > 0 || match.player2GameWins > 0;
  const score1 = hasGameWins
    ? String(match.player1GameWins)
    : isDraw
      ? '½'
      : (match.score ? (match.score.split('-')[0] ?? '') : '');
  const score2 = hasGameWins
    ? String(match.player2GameWins)
    : isDraw
      ? '½'
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

  // Band markers + upward-arrows for BALANCED_LIECHTENSTEIN cross-band matches.
  // Show only when both players have known bands.
  const hasBands = player1Band != null && player2Band != null;
  const bandDiff = hasBands ? player1Band - player2Band : 0;
  // p1UpArrows > 0 → p1 is the underdog (lower band than p2)
  const p1UpArrows = hasBands && bandDiff < 0 ? Math.abs(bandDiff) : 0;
  const p2UpArrows = hasBands && bandDiff > 0 ? Math.abs(bandDiff) : 0;

  return (
    <div
      className={`w-full h-full ${outlineCls} rounded flex flex-col overflow-hidden ${hoverCls} relative`}
      onClick={onClick}
    >
      {isGrandFinal && (
        <div className="absolute top-0 right-0 bg-rizzotto-gold-500/20 text-rizzotto-gold-400 text-[8px] font-bold uppercase tracking-wider px-1 rounded-bl border-l border-b border-rizzotto-gold-500/40">
          {tournamentMode === 'BALANCED_LIECHTENSTEIN' ? 'Division Final' : 'Grand Final'}
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
      {isCatchupBye && (
        <div className="absolute top-0 right-0 bg-stone-900/80 text-stone-500 text-[8px] font-medium tracking-wider px-1 rounded-bl border-l border-b border-stone-700/40">
          Catch-up · 0 pts
        </div>
      )}
      {isPendingBye && (
        <div className="absolute top-0 right-0 bg-stone-900/80 text-stone-500 text-[8px] font-medium tracking-wider px-1 rounded-bl border-l border-b border-stone-700/40">
          BYE · pending
        </div>
      )}
      {isWithdrawnVoid && (
        <div className="absolute top-0 right-0 bg-amber-950/70 text-amber-600 text-[8px] font-medium tracking-wider px-1 rounded-bl border-l border-b border-amber-700/30">
          Withdrew → re-paired
        </div>
      )}
      {!isWithdrawnVoid && match.withdrawnPlayerId && match.status === 'PENDING' && (
        <div className="absolute top-0 right-0 bg-stone-900/80 text-amber-500/80 text-[8px] font-medium tracking-wider px-1 rounded-bl border-l border-b border-amber-700/30">
          Opponent withdrew
        </div>
      )}
      {/* Player 1 row */}
      <div className="flex-1 flex items-center px-2 border-b border-stone-800">
        {match.player1Id && <PlayerAvatar name={player1Name} avatarUrl={player1AvatarUrl} />}
        <span
          className={`flex-1 text-xs truncate ${
            p1Dropped
              ? 'line-through text-stone-300'
              : p1Winner
                ? 'text-rizzotto-gold-500 font-semibold'
                : match.player1Id
                  ? 'text-stone-300'
                  : 'text-stone-500 italic'
          }`}
        >
          {match.player1Id
            ? (player1Name ?? match.player1Id)
            : (p1SlotLabel ?? (isAnyBye ? 'BYE' : 'TBD'))}
        </span>
        {p1Dropped && (
          <span className="text-[9px] text-red-400 uppercase tracking-wider ml-1 font-semibold">out</span>
        )}
        {/* Band dot + upward arrows for BALANCED_LIECHTENSTEIN */}
        {player1Band != null && match.player1Id && <BandDot band={player1Band} />}
        {p1UpArrows > 0 && <UpArrows count={p1UpArrows} />}
        {showFaction && match.player1Id && <FactionIndicator faction={player1Faction} />}
        {score1 && !p1Dropped && (
          <span
            className={`text-xs ml-1 tabular-nums ${isDraw ? 'text-amber-400' : p1Winner ? 'text-rizzotto-gold-500 font-semibold' : 'text-stone-400'}`}
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
            p2Dropped
              ? 'line-through text-stone-300'
              : p2Winner
                ? 'text-rizzotto-gold-500 font-semibold'
                : match.player2Id
                  ? 'text-stone-300'
                  : 'text-stone-500 italic'
          }`}
        >
          {match.player2Id
            ? (player2Name ?? match.player2Id)
            : (p2SlotLabel ?? (isAnyBye ? 'BYE' : 'TBD'))}
        </span>
        {p2Dropped && (
          <span className="text-[9px] text-red-400 uppercase tracking-wider ml-1 font-semibold">out</span>
        )}
        {/* Band dot + upward arrows for BALANCED_LIECHTENSTEIN */}
        {player2Band != null && match.player2Id && <BandDot band={player2Band} />}
        {p2UpArrows > 0 && <UpArrows count={p2UpArrows} />}
        {showFaction && match.player2Id && <FactionIndicator faction={player2Faction} />}
        {score2 && !p2Dropped && (
          <span
            className={`text-xs ml-1 tabular-nums ${isDraw ? 'text-amber-400' : p2Winner ? 'text-rizzotto-gold-500 font-semibold' : 'text-stone-400'}`}
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
