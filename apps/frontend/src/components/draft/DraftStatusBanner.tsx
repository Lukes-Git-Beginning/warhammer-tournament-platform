import type { DraftView, DraftTurn } from '@tww3/types';

interface DraftStatusBannerProps {
  draft: DraftView;
  currentTurn: DraftTurn | null;
  isMyTurn: boolean | null;
}

const ACTION_LABEL: Record<string, string> = {
  pick: 'PICK',
  ban: 'BAN',
  snipe: 'SNIPE',
  steal: 'STEAL',
  reveal_picks: 'PICKS AUFDECKEN',
  reveal_bans: 'BANS AUFDECKEN',
  reveal_all: 'ALLES AUFDECKEN',
};

export function DraftStatusBanner({ draft, currentTurn, isMyTurn }: DraftStatusBannerProps) {
  if (draft.status === 'COMPLETED') {
    return (
      <div className="flex items-center justify-center rounded-md border border-emerald-800 bg-emerald-950/40 px-4 py-3 text-center text-emerald-300 font-semibold text-lg">
        Draft abgeschlossen
      </div>
    );
  }

  if (draft.status === 'CANCELLED') {
    return (
      <div className="flex items-center justify-center rounded-md border border-stone-700 bg-stone-900/60 px-4 py-3 text-center text-stone-400 font-semibold text-lg">
        Draft abgebrochen
      </div>
    );
  }

  if (draft.status === 'PENDING') {
    return (
      <div className="flex items-center justify-center rounded-md border border-yellow-800 bg-yellow-950/40 px-4 py-3 text-center text-yellow-300 font-semibold">
        Warte auf Spieler…
      </div>
    );
  }

  // ONGOING
  if (isMyTurn && currentTurn) {
    const actionLabel = ACTION_LABEL[currentTurn.action] ?? currentTurn.action.toUpperCase();
    return (
      <div className="flex items-center justify-center rounded-md border-2 border-red-700 bg-red-950/50 px-4 py-3 text-center animate-pulse">
        <span className="text-red-300 font-black text-xl tracking-wide">
          DEIN ZUG: {actionLabel}
        </span>
      </div>
    );
  }

  if (currentTurn) {
    const actor = currentTurn.actor === 'host' ? 'Host' : currentTurn.actor === 'guest' ? 'Gast' : 'Admin';
    const actionLabel = ACTION_LABEL[currentTurn.action] ?? currentTurn.action;
    return (
      <div className="flex items-center justify-center rounded-md border border-stone-700 bg-stone-900/40 px-4 py-3 text-center text-stone-400 font-medium">
        {actor} ist am Zug: {actionLabel}…
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center rounded-md border border-stone-700 bg-stone-900/40 px-4 py-3 text-center text-stone-500 font-medium">
      Warte auf nächsten Zug…
    </div>
  );
}
