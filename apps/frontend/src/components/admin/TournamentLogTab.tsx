import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listTournaments, getTournamentEvents, type Tournament, type TournamentEventDto } from '@/lib/api';
import { formatInUserTimezone } from '@/lib/timezone';

/** Snake_case event type → a readable label, e.g. 'playoff_division_generated' → 'Playoff division generated'. */
function humanizeType(t: string): string {
  const s = t.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Compact one-line summary of a payload object — arrays shown as counts, long strings truncated. */
function formatPayload(p: unknown): string {
  if (!p || typeof p !== 'object') return '';
  return Object.entries(p as Record<string, unknown>)
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}: ${v.length}`;
      if (v && typeof v === 'object') return `${k}: {…}`;
      if (typeof v === 'string' && v.length > 40) return `${k}: ${v.slice(0, 40)}…`;
      return `${k}: ${String(v)}`;
    })
    .join(' · ');
}

function EventRow({ e }: { e: TournamentEventDto }) {
  const detail = formatPayload(e.payload);
  return (
    <li className="flex flex-col gap-0.5 border-b border-stone-800/60 py-2 sm:flex-row sm:items-baseline sm:gap-3">
      <span className="shrink-0 whitespace-nowrap font-mono text-xs text-stone-500 sm:w-44">
        {formatInUserTimezone(e.createdAt)}
      </span>
      <span className="flex-1 leading-relaxed">
        <span className="mr-2 rounded bg-stone-800 px-2 py-0.5 text-xs font-medium text-rizzotto-gold-500">
          {humanizeType(e.type)}
        </span>
        {e.subjectName && <span className="text-stone-300">{e.subjectName} </span>}
        <span className="text-xs text-stone-500">
          by {e.actorName ?? e.actor}
          {detail && <span className="ml-2 text-stone-600">· {detail}</span>}
        </span>
      </span>
    </li>
  );
}

/**
 * The tournaments list endpoint caps pageSize at 100, so page through it to fetch ALL tournaments.
 * (We are already at ~99 since launch — a fixed 100 cap would silently drop the rest.)
 */
async function fetchAllTournaments(): Promise<Tournament[]> {
  const pageSize = 100;
  const first = await listTournaments(1, pageSize);
  const all = [...first.data];
  const totalPages = Math.ceil(first.total / pageSize);
  for (let p = 2; p <= totalPages; p++) {
    const next = await listTournaments(p, pageSize);
    all.push(...next.data);
  }
  return all;
}

export function TournamentLogTab() {
  const [selected, setSelected] = useState<Tournament | null>(null);

  const { data: tournaments = [], isLoading: listLoading } = useQuery({
    queryKey: ['admin-tournament-log-list'],
    queryFn: fetchAllTournaments,
  });

  const {
    data: log,
    isLoading: logLoading,
    error: logError,
  } = useQuery({
    queryKey: ['admin-tournament-log', selected?.slug],
    queryFn: () => getTournamentEvents(selected!.slug),
    enabled: !!selected,
  });

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      {/* Tournament list */}
      <div className="lg:w-72 lg:shrink-0">
        <h3 className="mb-2 font-display text-sm font-semibold text-rizzotto-gold-400">Tournaments</h3>
        {listLoading && <div className="py-4 text-sm text-stone-400">Loading…</div>}
        <ul className="max-h-[70vh] divide-y divide-stone-800/60 overflow-y-auto rounded-md border border-stone-800">
          {tournaments.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => setSelected(t)}
                className={`flex w-full flex-col items-start px-3 py-2 text-left transition-colors hover:bg-stone-800/40 ${
                  selected?.id === t.id ? 'bg-stone-800/60' : ''
                }`}
              >
                <span className="text-sm text-stone-200">{t.name}</span>
                <span className="text-xs text-stone-500">{t.status}</span>
              </button>
            </li>
          ))}
          {!listLoading && tournaments.length === 0 && (
            <li className="px-3 py-4 text-sm text-stone-500">No tournaments.</li>
          )}
        </ul>
      </div>

      {/* Event log for the selected tournament */}
      <div className="min-w-0 flex-1">
        {!selected && (
          <div className="py-8 text-center text-sm text-stone-500">
            Select a tournament to load its event log.
          </div>
        )}
        {selected && (
          <>
            <h3 className="mb-3 font-display text-base font-semibold text-rizzotto-gold-400">
              {selected.name} — Event Log
            </h3>
            {logLoading && <div className="py-4 text-sm text-stone-400">Loading…</div>}
            {logError && (
              <div className="rounded-md border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
                Failed to load event log.
              </div>
            )}
            {log && log.events.length === 0 && (
              <div className="py-8 text-center text-sm text-stone-500">
                No events recorded for this tournament. (The log only captures events from when it went live.)
              </div>
            )}
            {log && log.events.length > 0 && (
              <ul className="text-sm">
                {log.events.map((e) => (
                  <EventRow key={e.id} e={e} />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
