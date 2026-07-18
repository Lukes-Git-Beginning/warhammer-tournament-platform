import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api.js';
import type { CalendarTournament, TournamentStatus } from '@rizzotto/types';
import { PageShell } from '@/components/layout/PageShell.js';
import { Skeleton } from '@/components/ui/skeleton.js';
import { EmptyState } from '@/components/ui/empty-state.js';
import { MonthCalendarGrid } from '@/components/calendar/MonthCalendarGrid.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_STATUSES: TournamentStatus[] = [
  'DRAFT',
  'OPEN_REGISTRATION',
  'REGISTRATION_CLOSED',
  'ONGOING',
  'COMPLETED',
];

const STATUS_LABELS: Record<TournamentStatus, string> = {
  DRAFT: 'Draft',
  OPEN_REGISTRATION: 'Registration Open',
  REGISTRATION_CLOSED: 'Registration Closed',
  ONGOING: 'Ongoing',
  COMPLETED: 'Completed',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function monthTitle(d: Date): string {
  return d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
}

function addMonths(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}

// ---------------------------------------------------------------------------
// Loading skeleton — rough approximation of a calendar grid
// ---------------------------------------------------------------------------

function CalendarSkeleton() {
  return (
    <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-800">
      {Array.from({ length: 7 }).map((_, i) => (
        <Skeleton key={`h-${i}`} className="h-8 rounded-none" />
      ))}
      {Array.from({ length: 35 }).map((_, i) => (
        <Skeleton key={`c-${i}`} className="h-20 rounded-none" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function CalendarPage() {
  // Cursor = first day of the currently visible month
  const [cursor, setCursor] = useState<Date>(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const [statusFilter, setStatusFilter] = useState<TournamentStatus | ''>('');
  const [majorOnly, setMajorOnly] = useState(false);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  // date_from = first moment of first day, date_to = last moment of last day
  const dateFrom = cursor.toISOString();
  const dateTo = new Date(year, month + 1, 0, 23, 59, 59, 999).toISOString();

  // Build query-string for both the API call and the ICS link
  function buildQs(extra?: Record<string, string>): string {
    const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
    if (statusFilter) params.set('status', statusFilter);
    if (majorOnly) params.set('is_major', 'true');
    if (extra) {
      for (const [k, v] of Object.entries(extra)) params.set(k, v);
    }
    return params.toString();
  }

  const { data, isLoading, isError } = useQuery({
    queryKey: ['calendar', year, month, statusFilter, majorOnly],
    queryFn: () =>
      apiFetch<CalendarTournament[]>(`/api/tournaments/calendar?${buildQs()}`),
    retry: false,
  });

  return (
    <PageShell variant="wide" spacing="base">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold text-rizzotto-gold-500">
          Tournament Calendar
        </h1>
        <p className="mt-2 text-sm text-rizzotto-stone-400">
          All musters at a glance — past, ongoing, and upcoming.
        </p>
      </div>

      {/* Filter bar */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        {/* Status select */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as TournamentStatus | '')}
          className="rounded border border-rizzotto-iron-700 bg-rizzotto-iron-900 px-3 py-1.5 text-sm text-rizzotto-stone-200 transition-colors focus:border-rizzotto-gold-500/60 focus:outline-none"
        >
          <option value="">Alle Status</option>
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>

        {/* Majors toggle */}
        <label className="flex cursor-pointer items-center gap-2 text-sm text-rizzotto-stone-300">
          <input
            type="checkbox"
            checked={majorOnly}
            onChange={(e) => setMajorOnly(e.target.checked)}
            className="accent-rizzotto-gold-500 size-4 cursor-pointer rounded"
          />
          Majors only
        </label>

        {/* Spacer */}
        <div className="flex-1" />

        {/* ICS subscribe link */}
        <a
          href={`/api/tournaments/calendar.ics?${buildQs()}`}
          className="inline-flex items-center gap-1.5 rounded border border-rizzotto-iron-600 bg-rizzotto-iron-800 px-3 py-1.5 text-xs font-medium text-rizzotto-stone-300 transition-colors hover:border-rizzotto-iron-500 hover:text-rizzotto-stone-100"
          download
        >
          {/* Calendar icon (inline SVG, no dependency) */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="size-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
            aria-hidden="true"
          >
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          Kalender abonnieren (.ics)
        </a>
      </div>

      {/* Month navigation */}
      <div className="mb-4 flex items-center gap-4">
        <button
          type="button"
          onClick={() => setCursor((c) => addMonths(c, -1))}
          className="rounded border border-rizzotto-iron-700 px-3 py-1.5 text-sm text-rizzotto-stone-300 transition-colors hover:border-rizzotto-iron-500 hover:text-rizzotto-stone-100"
          aria-label="Previous month"
        >
          ←
        </button>

        <h2 className="min-w-[12rem] text-center font-display text-xl font-semibold capitalize text-rizzotto-stone-100">
          {monthTitle(cursor)}
        </h2>

        <button
          type="button"
          onClick={() => setCursor((c) => addMonths(c, 1))}
          className="rounded border border-rizzotto-iron-700 px-3 py-1.5 text-sm text-rizzotto-stone-300 transition-colors hover:border-rizzotto-iron-500 hover:text-rizzotto-stone-100"
          aria-label="Next month"
        >
          →
        </button>

        {/* Jump to today */}
        <button
          type="button"
          onClick={() => {
            const d = new Date();
            setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
          }}
          className="ml-auto rounded border border-rizzotto-iron-700 px-3 py-1.5 text-xs text-rizzotto-stone-400 transition-colors hover:border-rizzotto-iron-500 hover:text-rizzotto-stone-200"
        >
          Today
        </button>
      </div>

      {/* Calendar body */}
      {isLoading && <CalendarSkeleton />}

      {!isLoading && isError && (
        <EmptyState
          variant="sigil"
          title="Failed to load"
          body="The calendar could not be loaded. Please try again later."
        />
      )}

      {!isLoading && !isError && (
        <>
          <MonthCalendarGrid monthDate={cursor} tournaments={data ?? []} />

          {(data ?? []).length === 0 && (
            <p className="mt-4 text-center text-sm text-rizzotto-stone-500">
              No tournaments found this month.
            </p>
          )}
        </>
      )}
    </PageShell>
  );
}
