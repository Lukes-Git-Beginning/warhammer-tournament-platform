import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getAdminPlayersReport,
  getAdminScheduleReport,
  type AdminScheduleReport,
} from '@/lib/api.js';
import { timezoneCounts, windowGames } from '@/lib/player-report';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

type Layer =
  | 'tournamentAvailability'
  | 'matchmakingAvailability'
  | 'tournamentsStarted'
  | 'avgTournamentField'
  | 'openPlayGames';
const LAYERS: { key: Layer; label: string; hint: string }[] = [
  {
    key: 'tournamentAvailability',
    label: 'Tournament availability',
    hint: 'Players with a tournament slot at that hour (paused excluded)',
  },
  {
    key: 'matchmakingAvailability',
    label: 'Matchmaking availability',
    hint: 'Players with a matchmaking slot at that hour (paused excluded)',
  },
  {
    key: 'tournamentsStarted',
    label: 'Tournaments started',
    hint: 'Tournaments that started at that hour in the window',
  },
  {
    key: 'avgTournamentField',
    label: 'Avg tournament field',
    hint: 'Average checked-in field of those tournaments',
  },
  {
    key: 'openPlayGames',
    label: 'Open Play games',
    hint: 'Open Play games finished at that hour in the window',
  },
];

function Heat({ grid }: { grid: number[][] }) {
  const max = Math.max(1, ...grid.flat());
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-0.5 text-[10px]">
        <thead>
          <tr>
            <th />
            {Array.from({ length: 24 }, (_, h) => (
              <th key={h} className="w-6 font-normal text-stone-500">
                {String(h).padStart(2, '0')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map((row, d) => (
            <tr key={d}>
              <td className="pr-1.5 text-stone-400">{DAYS[d]}</td>
              {row.map((v, h) => (
                <td
                  key={h}
                  title={`${DAYS[d]} ${String(h).padStart(2, '0')}:00 — ${v}`}
                  className="h-6 w-6 rounded-sm text-center align-middle text-stone-100"
                  style={{
                    background: v
                      ? `rgba(200,169,110,${0.15 + 0.85 * (v / max)})`
                      : 'rgba(68,64,60,0.35)',
                  }}
                >
                  {v ? (Number.isInteger(v) ? v : v.toFixed(0)) : ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Best hours by tournament availability, with what actually ran there. */
function topSlots(r: AdminScheduleReport) {
  const out: { d: number; h: number; avail: number; started: number; field: number }[] = [];
  r.tournamentAvailability.forEach((row, d) =>
    row.forEach((avail, h) =>
      out.push({
        d,
        h,
        avail,
        started: r.tournamentsStarted[d]?.[h] ?? 0,
        field: r.avgTournamentField[d]?.[h] ?? 0,
      }),
    ),
  );
  return out
    .filter((s) => s.avail > 0)
    .sort((a, b) => b.avail - a.avail)
    .slice(0, 12);
}

/** When are players available vs. when do events actually run — plus where active players live. */
export function ScheduleReport({ days }: { days: number }) {
  const [layer, setLayer] = useState<Layer>('tournamentAvailability');
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-schedule-report', days],
    queryFn: () => getAdminScheduleReport(days),
    staleTime: 60_000,
  });
  const players = useQuery({
    queryKey: ['admin-players-report', days],
    queryFn: () => getAdminPlayersReport(days),
    staleTime: 60_000,
  });
  const zones = useMemo(
    () => timezoneCounts((players.data?.players ?? []).filter((r) => windowGames(r) > 0)),
    [players.data],
  );
  const top = useMemo(() => (data ? topSlots(data) : []), [data]);

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
        <div>
          <h3 className="font-display text-lg font-semibold text-rizzotto-gold-500">
            Schedule fit
          </h3>
          <p className="text-xs text-stone-500">
            Weekday × hour in site time ({data?.timezone ?? 'Europe/Berlin'}). Availability is
            projected from each player&rsquo;s own timezone for the current week; events and games
            cover the selected window.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {LAYERS.map((l) => (
            <button
              key={l.key}
              type="button"
              title={l.hint}
              onClick={() => setLayer(l.key)}
              className={`rounded border px-2.5 py-1 text-xs transition-colors ${
                layer === l.key
                  ? 'border-rizzotto-gold-500 bg-rizzotto-gold-500/15 text-rizzotto-gold-300'
                  : 'border-stone-700 text-stone-400 hover:bg-stone-800'
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
        {isLoading && <p className="py-4 text-center text-sm text-stone-400">Loading…</p>}
        {error && (
          <div className="rounded border border-red-900 bg-red-950/40 p-3 text-xs text-red-300">
            Failed to load.
          </div>
        )}
        {data && <Heat grid={data[layer]} />}
      </section>

      {data && (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
            <h3 className="font-display text-base font-semibold text-rizzotto-gold-500">
              Best hours for tournaments
            </h3>
            <p className="mb-2 text-xs text-stone-500">
              Hours with the most tournament availability, and how many tournaments started there in
              the window. High availability with nothing hosted is an open slot.
            </p>
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-2 py-1.5">Slot</th>
                  <th className="px-2 py-1.5">Available</th>
                  <th className="px-2 py-1.5">Hosted</th>
                  <th className="px-2 py-1.5">Avg field</th>
                </tr>
              </thead>
              <tbody>
                {top.map((s) => (
                  <tr
                    key={`${s.d}:${s.h}`}
                    className="border-t border-rizzotto-iron-800 text-stone-300"
                  >
                    <td className="px-2 py-1.5">
                      {DAYS[s.d]} {String(s.h).padStart(2, '0')}:00
                    </td>
                    <td className="px-2 py-1.5 font-semibold text-stone-100">{s.avail}</td>
                    <td className={`px-2 py-1.5 ${s.started ? '' : 'text-emerald-400'}`}>
                      {s.started || 'open'}
                    </td>
                    <td className="px-2 py-1.5">{s.started ? s.field : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
            <h3 className="font-display text-base font-semibold text-rizzotto-gold-500">
              Where active players are
            </h3>
            <p className="mb-2 text-xs text-stone-500">
              Timezones of players with a game in the window.
            </p>
            {players.isLoading && <p className="text-sm text-stone-400">Loading…</p>}
            <ul className="space-y-1 text-sm">
              {zones.map((z) => (
                <li key={z.zone} className="flex items-center gap-2">
                  <span className="w-48 truncate text-stone-300">{z.zone}</span>
                  <div className="h-2 flex-1 rounded bg-stone-800">
                    <div
                      className="h-2 rounded bg-rizzotto-gold-500/70"
                      style={{ width: `${(z.count / Math.max(1, zones[0]?.count ?? 1)) * 100}%` }}
                    />
                  </div>
                  <span className="w-8 text-right text-stone-400">{z.count}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
