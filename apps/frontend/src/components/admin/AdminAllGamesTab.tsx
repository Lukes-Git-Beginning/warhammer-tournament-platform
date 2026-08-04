import { Fragment, useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { getMetaGames, getGameAudit, getFactions, getMaps, editGame, deleteGame, type GameSearchFilters } from '@/lib/api';
import type { GameAuditIssue } from '@/lib/api';
import type { GameHistoryEntry } from '@rizzotto/types';

const ISSUE_LABELS: Record<GameAuditIssue, string> = {
  draw: 'Draw',
  missing_faction: 'Missing faction',
  mirror: 'Mirror',
  faction_not_allowed: 'Not allowed',
  sft_mismatch: 'SFT mismatch',
  official_but_void: 'Void but official',
};
import { formatInUserTimezone } from '@/lib/timezone';

const PAGE_SIZE = 50;
const selectClass =
  'rounded border border-rizzotto-iron-700 bg-rizzotto-iron-950 px-1.5 py-1 text-xs text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none max-w-[10rem]';

type EditBody = Parameters<typeof editGame>[2];

/** Debounce a value by `ms` — avoids a query per keystroke while typing a search. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Parse the All Games search box into structured filters. Plain words become player-name search;
 * `key:value` tokens (winner / map / faction / tournament) filter that dimension; a bare
 * "ladder"/"open play" becomes the tournament=ladder shortcut. Values may be "quoted" for spaces.
 */
export function parseGameSearch(input: string): GameSearchFilters {
  const f: GameSearchFilters = {};
  const words: string[] = [];
  // Match key:value (value optionally quoted) or a bare word/quoted phrase.
  const re = /(\w+):"([^"]+)"|(\w+):(\S+)|"([^"]+)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    const key = (m[1] ?? m[3])?.toLowerCase();
    const val = m[2] ?? m[4];
    const bare = m[5] ?? m[6];
    if (key && val) {
      if (key === 'winner' || key === 'map' || key === 'faction' || key === 'tournament') f[key] = val;
      else words.push(`${key}:${val}`); // unknown key → treat literally as a name word
    } else if (bare) {
      if (/^(ladder|open|openplay|queue)$/i.test(bare)) f.tournament = 'ladder';
      else words.push(bare);
    }
  }
  if (words.length) f.q = words.join(' ');
  return f;
}

/**
 * Admin-only global game list with inline editing. Every field writes through the
 * shared PATCH /api/matches/:id/games/:gameNumber endpoint (canManageTournament),
 * which rebuilds stats and reflects on every game list. The display tables
 * (tournament + Meta "All Games") stay read-only.
 */
export function AdminAllGamesTab() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search, 350);
  const filters = parseGameSearch(debouncedSearch);
  const filterKey = JSON.stringify(filters);
  // Reset to page 1 whenever the search changes.
  useEffect(() => { setPage(1); }, [filterKey]);
  const { data, isLoading: allLoading } = useQuery({
    queryKey: ['admin-all-games', page, filterKey],
    queryFn: () => getMetaGames(page, PAGE_SIZE, filters),
    enabled: !flaggedOnly,
  });
  const { data: auditData, isLoading: auditLoading } = useQuery({
    queryKey: ['admin-game-audit'],
    queryFn: () => getGameAudit(),
    enabled: flaggedOnly,
  });
  const { data: factionsData } = useQuery({ queryKey: ['factions'], queryFn: () => getFactions(), staleTime: 60 * 60_000 });
  const { data: mapsData } = useQuery({ queryKey: ['all-maps'], queryFn: () => getMaps(), staleTime: 60 * 60_000 });
  const factions = (factionsData?.data ?? []).map((e) => e.faction);
  const maps = mapsData?.data ?? [];

  const mutation = useMutation({
    mutationFn: ({ game, body }: { game: GameHistoryEntry; body: EditBody }) =>
      editGame(game.matchId, game.gameNumber, body),
    onMutate: ({ game }) => {
      setSavingId(game.id);
      setRowError((e) => {
        const c = { ...e };
        delete c[game.id];
        return c;
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-all-games'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-game-audit'] });
      void queryClient.invalidateQueries({ queryKey: ['meta-games'] });
      void queryClient.invalidateQueries({ queryKey: ['factions'] });
    },
    onError: (err: Error, { game }) => {
      setRowError((e) => ({ ...e, [game.id]: err.message }));
      void queryClient.invalidateQueries({ queryKey: ['admin-all-games', page] });
    },
    onSettled: () => setSavingId(null),
  });

  const deleteMutation = useMutation({
    mutationFn: (game: GameHistoryEntry) => deleteGame(game.matchId, game.gameNumber),
    onMutate: (game) => {
      setSavingId(game.id);
      setRowError((e) => {
        const c = { ...e };
        delete c[game.id];
        return c;
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-all-games'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-game-audit'] });
      void queryClient.invalidateQueries({ queryKey: ['meta-games'] });
    },
    onError: (err: Error, game) => setRowError((e) => ({ ...e, [game.id]: err.message })),
    onSettled: () => setSavingId(null),
  });

  const games = (flaggedOnly ? (auditData?.games ?? []) : (data?.games ?? [])) as Array<
    GameHistoryEntry & { issues?: GameAuditIssue[] }
  >;
  const total = flaggedOnly ? (auditData?.total ?? 0) : (data?.total ?? 0);
  const isLoading = flaggedOnly ? auditLoading : allLoading;
  const totalPages = flaggedOnly ? 1 : Math.max(1, Math.ceil(total / PAGE_SIZE));
  const colSpan = flaggedOnly ? 14 : 13;

  const save = (game: GameHistoryEntry, body: EditBody) => mutation.mutate({ game, body });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="font-display text-xl font-semibold text-rizzotto-gold-500">
            {flaggedOnly ? 'Flagged Games' : 'All Games'}{' '}
            <span className="text-sm font-normal text-stone-500">({total}{flaggedOnly ? ' flagged' : ' total'})</span>
          </h2>
          <button
            type="button"
            onClick={() => setFlaggedOnly((v) => !v)}
            className={`rounded border px-2.5 py-1 text-xs transition-colors ${
              flaggedOnly
                ? 'border-amber-600 text-amber-300 hover:border-amber-400'
                : 'border-stone-700 text-stone-400 hover:border-rizzotto-gold-500 hover:text-rizzotto-gold-400'
            }`}
          >
            {flaggedOnly ? '← All games' : '⚑ Flagged only'}
          </button>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center gap-3 text-sm">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1 rounded border border-stone-700 text-stone-400 hover:border-rizzotto-gold-500 hover:text-rizzotto-gold-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              ← Prev
            </button>
            <span className="text-stone-500">{page} / {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1 rounded border border-stone-700 text-stone-400 hover:border-rizzotto-gold-500 hover:text-rizzotto-gold-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* Search — plain words match player names; operators winner: / map: / faction: /
          tournament: (and "ladder") filter those dimensions. All AND-combined. */}
      {!flaggedOnly && (
        <div className="mb-4">
          <div className="relative">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder='Search — e.g. "RizzOtto Welshlion", winner:RizzOtto, map:jade, faction:kislev, tournament:saturday, ladder'
              className="w-full rounded border border-rizzotto-iron-700 bg-rizzotto-iron-950 px-3 py-2 pr-16 text-sm text-stone-100 placeholder:text-stone-600 focus:border-rizzotto-gold-500 focus:outline-none"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-0.5 text-xs text-stone-500 hover:text-stone-300"
              >
                clear
              </button>
            )}
          </div>
          <p className="mt-1 text-[11px] text-stone-600">
            Operators: <code>winner:</code> <code>map:</code> <code>faction:</code> <code>tournament:</code> · use quotes for spaces (<code>map:&quot;Jade Tomb&quot;</code>) · plain words search player names.
          </p>
        </div>
      )}

      <p className="mb-3 text-xs text-stone-500">
        Inline-edit factions, map, winner and the Official flag (Official games count for every
        statistic — leaderboard, heatmaps, faction stats), or ✕ to hard-delete. Changing a winner
        that would flip the match result is rejected — use the match-result editor for that.
        {' '}<span className="text-amber-400/80">Flagged only</span> lists games with a data
        anomaly (draw, missing/mirror faction, faction outside the allowlist, SFT mismatch, or an
        Official game on a voided match) so you can clean them up.
      </p>

      {isLoading && (
        <div className="flex justify-center py-8">
          <span className="h-6 w-6 rounded-full border-2 border-rizzotto-gold-400 border-t-transparent animate-spin" />
        </div>
      )}

      {!isLoading && (
        // Full-bleed: break out of the admin container's max width — this table is wide and
        // side-scrolling is painful. Near-full viewport width; still scrolls if truly needed.
        <div className="relative left-1/2 w-[98vw] -translate-x-1/2 overflow-x-auto rounded-md border border-stone-800">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-stone-800 bg-stone-900/60 text-left">
                <th className="px-3 py-2 font-medium text-stone-400">Game ID</th>
                {flaggedOnly && <th className="px-3 py-2 font-medium text-stone-400">Issues</th>}
                <th className="px-3 py-2 font-medium text-stone-400">Date</th>
                <th className="px-3 py-2 font-medium text-stone-400">Tournament</th>
                <th className="px-3 py-2 font-medium text-stone-400">R·G</th>
                <th className="px-3 py-2 font-medium text-stone-400">Player 1</th>
                <th className="px-3 py-2 font-medium text-stone-400">Faction</th>
                <th className="px-3 py-2 font-medium text-stone-400">Player 2</th>
                <th className="px-3 py-2 font-medium text-stone-400">Faction</th>
                <th className="px-3 py-2 font-medium text-stone-400">Map</th>
                <th className="px-3 py-2 font-medium text-stone-400">Winner</th>
                <th className="px-3 py-2 font-medium text-stone-400">Replay</th>
                <th className="px-3 py-2 font-medium text-stone-400">Official</th>
                <th className="px-3 py-2 font-medium text-stone-400" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-800/60">
              {games.map((g) => {
                const currentMapId = maps.find((m) => m.name === g.mapName)?.id ?? '';
                const busy = savingId === g.id;
                return (
                  <Fragment key={g.id}>
                    <tr className={`hover:bg-stone-800/30 transition-colors${busy ? ' opacity-60' : ''}`}>
                      <td className="px-3 py-2 font-mono text-[10px] text-stone-500" title={g.id}>{g.id.slice(0, 8)}</td>
                      {flaggedOnly && (
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {(g.issues ?? []).map((iss) => (
                              <span
                                key={iss}
                                className="rounded border border-amber-800/70 bg-amber-950/30 px-1.5 py-0.5 text-[10px] text-amber-300 whitespace-nowrap"
                              >
                                {ISSUE_LABELS[iss]}
                              </span>
                            ))}
                          </div>
                        </td>
                      )}
                      <td className="px-3 py-2 text-stone-500 text-xs whitespace-nowrap">
                        {g.playedAt ? formatInUserTimezone(g.playedAt) : '—'}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {g.tournament ? (
                          <Link to="/tournaments/$slug" params={{ slug: g.tournament.slug }} className="text-rizzotto-gold-400 hover:underline">
                            {g.tournament.name}
                          </Link>
                        ) : (
                          <span className="text-stone-500">{g.matchSource === 'CHALLENGE' ? 'Challenge' : 'Ladder'}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-stone-400 text-xs whitespace-nowrap">R{g.round}·G{g.gameNumber}</td>
                      <td className="px-3 py-2 text-stone-300 text-xs whitespace-nowrap">{g.player1?.username ?? '—'}</td>
                      <td className="px-3 py-2">
                        <select
                          className={selectClass}
                          value={g.player1FactionId ?? ''}
                          disabled={busy}
                          onChange={(e) => save(g, { player1FactionId: e.target.value || null })}
                        >
                          <option value="">— none —</option>
                          {factions.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-stone-300 text-xs whitespace-nowrap">{g.player2?.username ?? '—'}</td>
                      <td className="px-3 py-2">
                        <select
                          className={selectClass}
                          value={g.player2FactionId ?? ''}
                          disabled={busy}
                          onChange={(e) => save(g, { player2FactionId: e.target.value || null })}
                        >
                          <option value="">— none —</option>
                          {factions.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          className={selectClass}
                          value={currentMapId}
                          disabled={busy}
                          onChange={(e) => save(g, { pickedMapId: e.target.value || null })}
                        >
                          <option value="">— none —</option>
                          {maps.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          className={selectClass}
                          value={g.winnerId ?? ''}
                          disabled={busy}
                          onChange={(e) => save(g, { winnerId: e.target.value || null })}
                        >
                          <option value="">— none —</option>
                          {g.player1 && <option value={g.player1.id}>{g.player1.username}</option>}
                          {g.player2 && <option value={g.player2.id}>{g.player2.username}</option>}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {g.replayUrl
                          ? <a href={g.replayUrl} download className="text-rizzotto-gold-400 hover:text-rizzotto-gold-300 underline">Download</a>
                          : <span className="text-stone-600">—</span>}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => save(g, { countsForLeaderboard: g.countsForLeaderboard === false })}
                          title="Official games count for every statistic (leaderboard, heatmaps, faction stats). Click to toggle."
                          className={`rounded border px-2 py-0.5 text-[10px] transition-colors disabled:opacity-40 ${
                            g.countsForLeaderboard === false
                              ? 'border-stone-700 text-stone-500 hover:border-stone-500'
                              : 'border-emerald-800 text-emerald-400 hover:border-emerald-500'
                          }`}
                        >
                          {g.countsForLeaderboard === false ? 'Unofficial' : 'Official'}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            if (window.confirm(`Permanently delete game R${g.round}·G${g.gameNumber}? This cannot be undone.`)) {
                              deleteMutation.mutate(g);
                            }
                          }}
                          className="rounded border border-red-900 px-2 py-0.5 text-[10px] text-red-400 hover:border-red-600 hover:bg-red-900/20 transition-colors disabled:opacity-40"
                          title="Hard-delete this game"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                    {rowError[g.id] && (
                      <tr>
                        <td colSpan={colSpan} className="px-3 pb-2 text-xs text-red-400">
                          {rowError[g.id]}{' '}
                          <Link to="/matches/$matchId" params={{ matchId: g.matchId }} className="text-rizzotto-gold-400 hover:underline">
                            Open the match to edit →
                          </Link>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {games.length === 0 && (
                <tr><td colSpan={colSpan} className="px-3 py-6 text-center text-stone-500 text-sm">No games.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
