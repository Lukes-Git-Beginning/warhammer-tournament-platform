import { useTranslation } from 'react-i18next';
import type { DraftView, DraftTurn } from '@rizzotto/types';

interface DraftStatusBannerProps {
  draft: DraftView;
  currentTurn: DraftTurn | null;
  isMyTurn: boolean | null;
}

export function DraftStatusBanner({ draft, currentTurn, isMyTurn }: DraftStatusBannerProps) {
  const { t } = useTranslation();

  if (draft.status === 'COMPLETED') {
    return (
      <div className="flex items-center justify-center rounded-md border border-emerald-800 bg-emerald-950/40 px-4 py-3 text-center text-emerald-300 font-semibold text-lg">
        {t('draft.status.completed')}
      </div>
    );
  }

  if (draft.status === 'CANCELLED') {
    return (
      <div className="flex items-center justify-center rounded-md border border-stone-700 bg-stone-900/60 px-4 py-3 text-center text-stone-400 font-semibold text-lg">
        {t('draft.status.cancelled')}
      </div>
    );
  }

  if (draft.status === 'PENDING') {
    return (
      <div className="flex items-center justify-center rounded-md border border-yellow-800 bg-yellow-950/40 px-4 py-3 text-center text-yellow-300 font-semibold">
        {t('draft.status.waiting')}
      </div>
    );
  }

  // ONGOING
  if (isMyTurn && currentTurn) {
    const actionLabel = t(`draft.action.${currentTurn.action}`, { defaultValue: currentTurn.action.toUpperCase() });
    return (
      <div className="flex items-center justify-center rounded-md border-2 border-red-700 bg-red-950/50 px-4 py-3 text-center animate-pulse">
        <span className="text-red-300 font-black text-xl tracking-wide">
          {t('draft.status.your_turn')} {actionLabel}
        </span>
      </div>
    );
  }

  if (currentTurn) {
    const actor = t(`draft.actor.${currentTurn.actor}`, { defaultValue: currentTurn.actor });
    const actionLabel = t(`draft.action.${currentTurn.action}`, { defaultValue: currentTurn.action });
    return (
      <div className="flex items-center justify-center rounded-md border border-stone-700 bg-stone-900/40 px-4 py-3 text-center text-stone-400 font-medium">
        {t('draft.status.opponent_turn', { actor })} {actionLabel}…
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center rounded-md border border-stone-700 bg-stone-900/40 px-4 py-3 text-center text-stone-500 font-medium">
      {t('draft.status.waiting_next')}
    </div>
  );
}
