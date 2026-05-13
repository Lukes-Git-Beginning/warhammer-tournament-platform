import { useQuery } from '@tanstack/react-query';
import { getDraftEvents } from '@/lib/api';
import type { DraftEventDto } from '@tww3/types';

interface DraftHistoryProps {
  draftId: string;
}

const ACTION_LABEL: Record<string, string> = {
  pick: 'picked',
  ban: 'banned',
  snipe: 'sniped',
  steal: 'stole',
  reveal_picks: 'revealed picks',
  reveal_bans: 'revealed bans',
  reveal_all: 'revealed all',
  auto_select: 'auto-selected',
  start: 'started draft',
  complete: 'draft complete',
  cancel: 'cancelled',
};

function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action;
}

function EventRow({ ev }: { ev: DraftEventDto }) {
  const actorLabel =
    ev.actor === 'host' ? 'Host' : ev.actor === 'guest' ? 'Gast' : ev.actor === 'admin' ? 'Admin' : 'System';

  return (
    <div className="flex items-baseline gap-1.5 py-0.5 text-sm">
      <span className="w-6 shrink-0 font-mono text-xs text-stone-500 text-right">
        #{ev.turn_index + 1}
      </span>
      <span
        className={`shrink-0 font-semibold ${
          ev.actor === 'host'
            ? 'text-blue-400'
            : ev.actor === 'guest'
            ? 'text-red-400'
            : 'text-stone-400'
        }`}
      >
        {actorLabel}
      </span>
      <span className="text-stone-400">{actionLabel(ev.action)}</span>
      {ev.faction_id != null ? (
        <span className="text-emerald-400 font-medium truncate">{ev.faction_id}</span>
      ) : ev.action === 'pick' ? (
        <span className="text-stone-600">(versteckt)</span>
      ) : null}
      {ev.is_auto_selected && (
        <span className="text-amber-500 text-xs shrink-0">auto</span>
      )}
    </div>
  );
}

export function DraftHistory({ draftId }: DraftHistoryProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['draft', draftId, 'events'],
    queryFn: () => getDraftEvents(draftId),
    enabled: !!draftId,
  });

  return (
    <div className="rounded-md border border-stone-800 bg-stone-900/40 p-3">
      <h3 className="mb-3 font-display text-sm font-bold text-warhammer-gold uppercase tracking-wide">
        Verlauf
      </h3>
      {isLoading && (
        <div className="text-xs text-stone-500">Lade…</div>
      )}
      {!isLoading && (!data?.events || data.events.length === 0) && (
        <div className="text-xs text-stone-600 italic">Noch keine Aktionen</div>
      )}
      <div className="space-y-0.5 max-h-[500px] overflow-y-auto">
        {data?.events.map((ev) => (
          <EventRow key={ev.id} ev={ev} />
        ))}
      </div>
    </div>
  );
}
