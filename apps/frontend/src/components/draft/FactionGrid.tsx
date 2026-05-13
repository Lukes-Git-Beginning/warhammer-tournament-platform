import type { FactionDto, PublicDraftState, DraftTurn } from '@tww3/types';
import { FactionBadge } from '@/components/meta/FactionBadge';

type FactionStatus =
  | 'picked-host'
  | 'picked-guest'
  | 'banned'
  | 'banned-for-you'
  | 'available'
  | 'unavailable';

interface FactionGridProps {
  allFactions: FactionDto[];
  state: PublicDraftState;
  currentTurn: DraftTurn | null;
  viewerRole: 'host' | 'guest' | 'spectator' | 'admin';
  onPick: (factionId: string) => void;
}

const STATUS_CLASSES: Record<FactionStatus, string> = {
  'picked-host': 'border-blue-600 bg-blue-950/60 opacity-80',
  'picked-guest': 'border-red-700 bg-red-950/60 opacity-80',
  banned: 'border-stone-700 bg-stone-900/40 opacity-40',
  'banned-for-you': 'border-orange-800 bg-orange-950/40 opacity-50',
  available: 'border-stone-600 bg-stone-800/60 hover:border-warhammer-gold hover:bg-stone-700/60 cursor-pointer',
  unavailable: 'border-stone-800 bg-stone-900/30 opacity-30 cursor-not-allowed',
};

const PICK_BADGE: Record<string, string> = {
  'picked-host': 'Host',
  'picked-guest': 'Gast',
};

const PICK_BADGE_CLASS: Record<string, string> = {
  'picked-host': 'bg-blue-700 text-blue-100',
  'picked-guest': 'bg-red-800 text-red-100',
};

export function FactionGrid({ allFactions, state, currentTurn, viewerRole, onPick }: FactionGridProps) {
  function getFactionStatus(factionId: string): FactionStatus {
    if (state.picks.host.includes(factionId)) return 'picked-host';
    if (state.picks.guest.includes(factionId)) return 'picked-guest';
    if (state.bans.includes(factionId)) return 'banned';

    const sideBans =
      viewerRole === 'host'
        ? state.exclusive_bans.host
        : viewerRole === 'guest'
        ? state.exclusive_bans.guest
        : [];
    if (sideBans.includes(factionId)) return 'banned-for-you';

    // Also treat opponent's exclusive bans as globally banned for spectator/admin
    if (viewerRole === 'spectator' || viewerRole === 'admin') {
      const allExclusive = [...state.exclusive_bans.host, ...state.exclusive_bans.guest];
      if (allExclusive.includes(factionId)) return 'banned';
    }

    // Already hidden-picked/hidden-banned factions are still selectable from UI POV
    // (server validates); we mark them unavailable only if no active pick/ban turn
    if (
      currentTurn &&
      ['pick', 'ban', 'snipe', 'steal'].includes(currentTurn.action)
    ) {
      return 'available';
    }

    return 'unavailable';
  }

  const isActionTurn =
    currentTurn !== null &&
    ['pick', 'ban', 'snipe', 'steal'].includes(currentTurn.action);

  return (
    <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
      {allFactions.map((f) => {
        const status = getFactionStatus(f.id);
        const isInteractive = isActionTurn && status === 'available';

        return (
          <button
            key={f.id}
            type="button"
            onClick={() => {
              if (isInteractive) onPick(f.id);
            }}
            disabled={!isInteractive}
            className={`relative flex flex-col items-center gap-1 rounded-md border-2 p-2 text-center transition-all duration-150 ${STATUS_CLASSES[status]}`}
            title={`${f.name}${status === 'banned' ? ' (Gebannt)' : status === 'banned-for-you' ? ' (Für dich gebannt)' : ''}`}
            style={
              status === 'available' || status === 'picked-host' || status === 'picked-guest'
                ? { borderColor: f.color_hex }
                : undefined
            }
          >
            {/* Ban overlay */}
            {(status === 'banned' || status === 'banned-for-you') && (
              <div
                className="pointer-events-none absolute inset-0 rounded-md overflow-hidden"
                aria-hidden="true"
              >
                <div
                  className="absolute inset-0"
                  style={{
                    background:
                      'repeating-linear-gradient(-45deg, rgba(220,38,38,0.25) 0px, rgba(220,38,38,0.25) 2px, transparent 2px, transparent 8px)',
                  }}
                />
              </div>
            )}

            <FactionBadge
              colorHex={f.color_hex}
              initials={f.initials}
              name={f.name}
              size="md"
            />
            <div className="text-xs leading-tight text-stone-300 line-clamp-2">{f.name}</div>

            {/* Pick badge */}
            {(status === 'picked-host' || status === 'picked-guest') && (
              <span
                className={`text-[10px] font-bold px-1 py-0.5 rounded ${PICK_BADGE_CLASS[status]}`}
              >
                {PICK_BADGE[status]}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
