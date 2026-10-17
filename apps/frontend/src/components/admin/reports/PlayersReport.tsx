import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { SITE_TZ } from '@/lib/site-time';
import {
  getAdminNotInDiscordReport,
  getAdminPlayersReport,
  type AdminPlayerReportRow,
} from '@/lib/api.js';
import {
  BROADCAST_LIST_KEY,
  PRESETS,
  computeKpis,
  filterRows,
  openPlayGames,
  toCsv,
  windowGames,
  type BroadcastListHandoff,
  type Preset,
  type PresetContext,
} from '@/lib/player-report';

const chip = (active: boolean) =>
  `rounded border px-2.5 py-1 text-xs transition-colors ${
    active
      ? 'border-rizzotto-gold-500 bg-rizzotto-gold-500/15 text-rizzotto-gold-300'
      : 'border-stone-700 text-stone-400 hover:bg-stone-800 hover:text-stone-200'
  }`;
const btn =
  'rounded border border-stone-700 px-3 py-1.5 text-xs font-medium text-stone-300 transition-colors hover:border-rizzotto-gold-500 hover:text-rizzotto-gold-300 disabled:opacity-50';

const GROUPS = [...new Set(PRESETS.map((p) => p.group))];

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    timeZone: SITE_TZ,
    day: 'numeric',
    month: 'short',
    year: '2-digit',
  });
}

type SortKey =
  | 'username'
  | 'lastGame'
  | 'tournament'
  | 'openPlay'
  | 'avail'
  | 'hosted'
  | 'reliability'
  | 'replays'
  | 'dms'
  | 'lastLogin';

const SORTERS: Record<SortKey, (r: AdminPlayerReportRow) => number | string> = {
  username: (r) => r.username.toLowerCase(),
  lastGame: (r) => r.lastGameAt ?? '',
  tournament: (r) => r.tournamentGames,
  openPlay: (r) => openPlayGames(r),
  avail: (r) => r.mmSlots + r.tournamentSlots,
  hosted: (r) => r.hosted * 1000 + r.hostedTotal,
  reliability: (r) => r.noShows * 3 + r.queueTimeouts * 3 + r.queueWarnings + r.drops,
  replays: (r) => (windowGames(r) ? r.gamesWithReplay / windowGames(r) : -1),
  dms: (r) => r.dmFailed * 1000 + r.dmSent,
  lastLogin: (r) => r.lastLogin ?? '',
};

function Kpi({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded border border-rizzotto-iron-700 bg-rizzotto-iron-900/80 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-stone-500">{label}</div>
      <div className="text-lg font-semibold text-stone-100">{value}</div>
      {sub && <div className="text-[11px] text-stone-500">{sub}</div>}
    </div>
  );
}

function downloadCsv(rows: AdminPlayerReportRow[], name: string) {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function PlayersReport({ days }: { days: number }) {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [lapsedDays, setLapsedDays] = useState(21);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({
    key: 'lastGame',
    desc: true,
  });
  const [checkDiscord, setCheckDiscord] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-players-report', days],
    queryFn: () => getAdminPlayersReport(days),
    staleTime: 60_000,
  });
  // Discord membership costs one Discord API call per player, so it only runs on request.
  const discord = useQuery({
    queryKey: ['admin-not-in-discord-report'],
    queryFn: getAdminNotInDiscordReport,
    enabled: checkDiscord,
    staleTime: 10 * 60_000,
  });
  const notInDiscord = useMemo(
    () => (discord.data?.configured ? new Set(discord.data.users.map((u) => u.id)) : null),
    [discord.data],
  );

  const ctx: PresetContext = useMemo(() => {
    const nowMs = Date.now();
    return {
      nowMs,
      windowStartMs: days > 0 ? nowMs - days * 86_400_000 : 0,
      lapsedDays,
      notInDiscord,
    };
  }, [days, lapsedDays, notInDiscord]);

  const rows = useMemo(() => data?.players ?? [], [data]);
  const kpis = useMemo(() => computeKpis(rows, ctx), [rows, ctx]);
  const filtered = useMemo(() => {
    const out = filterRows(rows, selected, search, ctx);
    const get = SORTERS[sort.key];
    return out.sort((a, b) => {
      const x = get(a);
      const y = get(b);
      const c = x < y ? -1 : x > y ? 1 : 0;
      return sort.desc ? -c : c;
    });
  }, [rows, selected, search, ctx, sort]);

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const sortBy = (key: SortKey) =>
    setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== 'username' }));
  const presetLabel = (p: Preset) => p.label;
  const listLabel = selected.length
    ? selected
        .map((id) => PRESETS.find((p) => p.id === id))
        .filter((p): p is Preset => !!p)
        .map(presetLabel)
        .join(' + ')
    : 'All players';

  const useAsAudience = () => {
    const handoff: BroadcastListHandoff = { label: listLabel, userIds: filtered.map((r) => r.id) };
    try {
      sessionStorage.setItem(BROADCAST_LIST_KEY, JSON.stringify(handoff));
    } catch {
      return;
    }
    void navigate({ to: '/admin', search: { tab: 'broadcast', audience: 'report' } });
  };

  if (isLoading) return <p className="py-8 text-center text-sm text-stone-400">Loading players…</p>;
  if (error || !data) {
    return (
      <div className="rounded border border-red-900 bg-red-950/40 p-3 text-xs text-red-300">
        Failed to load the players report.
      </div>
    );
  }

  const Th = ({
    k,
    children,
    title,
  }: {
    k: SortKey;
    children: React.ReactNode;
    title?: string;
  }) => (
    <th className="px-2 py-2" title={title}>
      <button
        type="button"
        onClick={() => sortBy(k)}
        className="uppercase tracking-wide hover:text-stone-300"
      >
        {children}
        {sort.key === k ? (sort.desc ? ' ▾' : ' ▴') : ''}
      </button>
    </th>
  );

  return (
    <section className="space-y-4 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
      <div>
        <h3 className="font-display text-lg font-semibold text-rizzotto-gold-500">Players</h3>
        <p className="text-xs text-stone-500">
          What every player uses. Counts cover the selected window; last game and all-time totals
          ignore it. Feature shares are of active players (a game in the window). Pick filters
          below; they combine (AND).
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        <Kpi label="Players" value={kpis.players} />
        <Kpi label="Active" value={kpis.active} sub="a game in the window" />
        <Kpi
          label="MM availability"
          value={`${kpis.pct(kpis.mmAvail)}%`}
          sub={`${kpis.mmAvail} active`}
        />
        <Kpi
          label="Tourn. availability"
          value={`${kpis.pct(kpis.tAvail)}%`}
          sub={`${kpis.tAvail} active`}
        />
        <Kpi
          label="Open Play"
          value={`${kpis.pct(kpis.openPlay)}%`}
          sub={`${kpis.openPlay} active`}
        />
        <Kpi
          label="Tournaments"
          value={`${kpis.pct(kpis.tournaments)}%`}
          sub={`${kpis.tournaments} active`}
        />
        <Kpi label="Hosts" value={kpis.hosts} sub="in the window" />
        <Kpi label="Lapsed" value={kpis.lapsed} sub={`no game for ${lapsedDays}+ days`} />
      </div>

      <div className="space-y-2">
        {GROUPS.map((g) => (
          <div key={g} className="flex flex-wrap items-center gap-1.5">
            <span className="w-40 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-stone-500">
              {g}
            </span>
            {PRESETS.filter((p) => p.group === g).map((p) => (
              <button
                key={p.id}
                type="button"
                title={p.hint}
                onClick={() => toggle(p.id)}
                className={chip(selected.includes(p.id))}
              >
                {p.label}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search player…"
          className="w-48 rounded border border-stone-700 bg-stone-900 px-2 py-1.5 text-xs text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none"
        />
        <label className="flex items-center gap-1 text-xs text-stone-400">
          Lapsed after
          <input
            type="number"
            min={1}
            max={365}
            value={lapsedDays}
            onChange={(e) => setLapsedDays(Math.max(1, Number(e.target.value) || 21))}
            className="w-14 rounded border border-stone-700 bg-stone-900 px-1.5 py-1 text-xs text-stone-200"
          />
          days
        </label>
        <button
          type="button"
          className={btn}
          onClick={() => setCheckDiscord(true)}
          disabled={checkDiscord}
        >
          {discord.isFetching
            ? 'Checking Discord…'
            : notInDiscord
              ? `Discord checked (${notInDiscord.size} not in server)`
              : 'Check Discord membership'}
        </button>
        {selected.length > 0 && (
          <button type="button" className={btn} onClick={() => setSelected([])}>
            Clear filters
          </button>
        )}
        <span className="ml-auto text-xs text-stone-400">
          {filtered.length} of {rows.length}
        </span>
        <button
          type="button"
          className={btn}
          onClick={() =>
            downloadCsv(
              filtered,
              `players-${days || 'all'}d-${new Date().toISOString().slice(0, 10)}.csv`,
            )
          }
          disabled={filtered.length === 0}
        >
          Export CSV
        </button>
        <button
          type="button"
          className={btn}
          onClick={useAsAudience}
          disabled={filtered.length === 0}
        >
          Use as broadcast audience ({filtered.length})
        </button>
      </div>

      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-rizzotto-iron-900 text-[10px] text-stone-500">
            <tr>
              <Th k="username">Player</Th>
              <Th k="lastGame" title="Last game ever">
                Last game
              </Th>
              <Th k="tournament" title="Tournament games in the window">
                Tourn.
              </Th>
              <Th
                k="openPlay"
                title="Open Play games in the window: queue / availability DM / challenge"
              >
                Open Play
              </Th>
              <Th k="avail" title="Calendar slots: matchmaking / tournaments">
                Avail.
              </Th>
              <Th k="hosted" title="Hosted in the window (all time)">
                Hosted
              </Th>
              <Th k="reliability" title="No-shows / drops · queue warnings / timeouts (window)">
                Reliability
              </Th>
              <Th k="replays" title="Games with a replay in the window">
                Replays
              </Th>
              <Th k="dms" title="Bot DMs in the window: delivered / failed">
                DMs
              </Th>
              <th
                className="px-2 py-2 uppercase tracking-wide"
                title="Questionnaire answered: Domination / Conquest / Land Battle / Siege"
              >
                Q&apos;naire
              </th>
              <Th k="lastLogin">Last login</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const op = openPlayGames(r);
              const wg = windowGames(r);
              return (
                <tr key={r.id} className="border-t border-rizzotto-iron-800 text-stone-300">
                  <td className="px-2 py-1.5">
                    <Link
                      to="/users/$id"
                      params={{ id: r.id }}
                      className="text-rizzotto-gold-400 hover:text-rizzotto-gold-300"
                    >
                      {r.username}
                    </Link>
                    {r.paused && (
                      <span className="ml-1.5 rounded bg-amber-900/40 px-1 text-[10px] text-amber-300">
                        paused
                      </span>
                    )}
                    {r.botPolicy !== 'NORMAL' && (
                      <span
                        className="ml-1.5 rounded bg-red-900/40 px-1 text-[10px] text-red-300"
                        title={r.botPolicy}
                      >
                        no DMs
                      </span>
                    )}
                    {notInDiscord?.has(r.id) && (
                      <span className="ml-1.5 rounded bg-stone-800 px-1 text-[10px] text-stone-400">
                        not in Discord
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-stone-400">{fmtDate(r.lastGameAt)}</td>
                  <td className="px-2 py-1.5">{r.tournamentGames || '·'}</td>
                  <td className="px-2 py-1.5">
                    {op
                      ? `${op} (${r.openPlayQueue}/${r.openPlayAvailability}/${r.openPlayChallenge})`
                      : '·'}
                  </td>
                  <td className="px-2 py-1.5">
                    {r.mmSlots || r.tournamentSlots ? `${r.mmSlots} / ${r.tournamentSlots}` : '·'}
                  </td>
                  <td className="px-2 py-1.5">
                    {r.hostedTotal ? `${r.hosted} (${r.hostedTotal})` : '·'}
                  </td>
                  <td className="px-2 py-1.5">
                    {r.noShows + r.drops + r.queueWarnings + r.queueTimeouts ? (
                      <span className={r.noShows >= 2 || r.queueTimeouts > 0 ? 'text-red-300' : ''}>
                        {r.noShows}/{r.drops} · {r.queueWarnings}/{r.queueTimeouts}
                      </span>
                    ) : (
                      '·'
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {wg ? `${Math.round((r.gamesWithReplay / wg) * 100)}%` : '·'}
                  </td>
                  <td className="px-2 py-1.5">
                    {r.dmSent + r.dmFailed ? (
                      <span className={r.dmFailed ? 'text-red-300' : ''}>
                        {r.dmSent}/{r.dmFailed}
                      </span>
                    ) : (
                      '·'
                    )}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-[11px]">
                    <span className={r.answered.DOMINATION ? 'text-emerald-400' : 'text-stone-600'}>
                      D
                    </span>{' '}
                    <span className={r.answered.CONQUEST ? 'text-emerald-400' : 'text-stone-600'}>
                      C
                    </span>{' '}
                    <span className={r.answered.LAND_BATTLE ? 'text-emerald-400' : 'text-stone-600'}>
                      L
                    </span>{' '}
                    <span className={r.answered.SIEGE ? 'text-emerald-400' : 'text-stone-600'}>
                      S
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-stone-500">{fmtDate(r.lastLogin)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="py-6 text-center text-sm text-stone-500">No players match these filters.</p>
        )}
      </div>
    </section>
  );
}
