import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAdminQueueActivity, type QueueActivityEntry, type QueueActivityEvent } from '@/lib/api';
import { formatInUserTimezone } from '@/lib/timezone';

const PAGE_SIZE = 20;

const EVENTS: QueueActivityEvent[] = [
  'JOIN',
  'LEAVE',
  'MATCH',
  'CANCEL',
  'WIN',
  'LOSE',
  'DRAW',
  'WARNING',
  'TIMEOUT',
];

const EVENT_STYLES: Record<QueueActivityEvent, string> = {
  JOIN: 'bg-sky-950/60 text-sky-300',
  LEAVE: 'bg-stone-800 text-stone-400',
  MATCH: 'bg-indigo-950/60 text-indigo-300',
  CANCEL: 'bg-amber-950/60 text-amber-300',
  WIN: 'bg-emerald-950/60 text-emerald-300',
  LOSE: 'bg-red-950/60 text-red-300',
  DRAW: 'bg-stone-700/60 text-stone-300',
  WARNING: 'bg-yellow-950/60 text-yellow-300', // #14 education-first heads-up
  TIMEOUT: 'bg-orange-950/60 text-orange-300', // #14 cooldown sanction
};

// #12 — where an Open-Play match came from.
const SOURCE_LABELS: Record<'QUEUE' | 'AVAILABILITY' | 'CHALLENGE', string> = {
  QUEUE: 'Queue',
  AVAILABILITY: 'Availability DM',
  CHALLENGE: 'Challenge',
};
const SOURCE_STYLES: Record<'QUEUE' | 'AVAILABILITY' | 'CHALLENGE', string> = {
  QUEUE: 'bg-indigo-950/50 text-indigo-300',
  AVAILABILITY: 'bg-teal-950/50 text-teal-300',
  CHALLENGE: 'bg-purple-950/50 text-purple-300',
};

function formatDate(iso: string): string {
  return formatInUserTimezone(iso);
}

function PlayerCell({
  username,
  id,
  avatarUrl,
}: {
  username: string | null;
  id: string | null;
  avatarUrl?: string | null;
}) {
  if (!username && !id) return <span className="text-stone-600">—</span>;
  const name = username ?? (id ? id.slice(0, 8) : '?');
  return (
    <span className="flex items-center gap-2">
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={name}
          className="h-6 w-6 rounded-full border border-stone-700 object-cover"
        />
      ) : (
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-stone-700 text-xs font-medium text-stone-200">
          {name[0]?.toUpperCase() ?? '?'}
        </span>
      )}
      <span className="text-stone-200">{name}</span>
    </span>
  );
}

export function QueueActivityTable() {
  const [page, setPage] = useState(1);
  const [eventFilter, setEventFilter] = useState<QueueActivityEvent | ''>('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-queue-activity', page, eventFilter],
    queryFn: () =>
      getAdminQueueActivity({
        page,
        pageSize: PAGE_SIZE,
        event: eventFilter || undefined,
      }),
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const entries: QueueActivityEntry[] = data?.entries ?? [];

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <label htmlFor="queue-event-filter" className="text-sm text-stone-400">
          Event:
        </label>
        <select
          id="queue-event-filter"
          value={eventFilter}
          onChange={(e) => {
            setPage(1);
            setEventFilter(e.target.value as QueueActivityEvent | '');
          }}
          className="rounded border border-stone-700 bg-stone-900 px-3 py-1.5 text-sm text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none"
        >
          <option value="">All events</option>
          {EVENTS.map((ev) => (
            <option key={ev} value={ev}>
              {ev}
            </option>
          ))}
        </select>
      </div>

      {isLoading && <div className="py-8 text-center text-stone-400 text-sm">Loading…</div>}

      {error && (
        <div className="rounded-md border border-red-900 bg-red-950/40 p-4 text-red-300 text-sm">
          Failed to load queue activity.
        </div>
      )}

      {!isLoading && !error && (
        <>
          {data?.matchSourceCounts && (
            <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-stone-500">Open-Play matches by origin (all time):</span>
              {(['QUEUE', 'AVAILABILITY', 'CHALLENGE'] as const).map((s) => (
                <span
                  key={s}
                  className={`rounded px-2 py-0.5 font-medium ${SOURCE_STYLES[s]}`}
                >
                  {SOURCE_LABELS[s]}: {data.matchSourceCounts[s]}
                </span>
              ))}
            </div>
          )}
          <div className="overflow-x-auto rounded-md border border-stone-800">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-stone-800 bg-stone-900/60">
                  <th className="px-4 py-3 text-left font-medium text-stone-400">Date</th>
                  <th className="px-4 py-3 text-left font-medium text-stone-400">Event</th>
                  <th className="px-4 py-3 text-left font-medium text-stone-400">Player</th>
                  <th className="px-4 py-3 text-left font-medium text-stone-400">Opponent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-800/60">
                {entries.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-stone-500">
                      No entries.
                    </td>
                  </tr>
                )}
                {entries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-stone-800/30 transition-colors">
                    <td className="px-4 py-3 text-stone-400 whitespace-nowrap">
                      {formatDate(entry.created_at)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${EVENT_STYLES[entry.event]}`}
                      >
                        {entry.event}
                      </span>
                      {entry.source && (
                        <span
                          className={`ml-1.5 rounded px-2 py-0.5 text-xs font-medium ${SOURCE_STYLES[entry.source]}`}
                        >
                          {SOURCE_LABELS[entry.source]}
                        </span>
                      )}
                      {entry.level != null && (
                        <span className="ml-1.5 text-xs text-stone-500">L{entry.level}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <PlayerCell
                        username={entry.user_username}
                        id={entry.user_id}
                        avatarUrl={entry.user_avatar_url}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <PlayerCell username={entry.opponent_username} id={entry.opponent_id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={() => setPage((p) => p - 1)}
                disabled={page <= 1}
                className="rounded border border-stone-700 px-3 py-1.5 text-stone-300 hover:border-stone-500 hover:text-stone-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                ← Back
              </button>
              <span className="text-stone-500">
                Page {page} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= totalPages}
                className="rounded border border-stone-700 px-3 py-1.5 text-stone-300 hover:border-stone-500 hover:text-stone-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
