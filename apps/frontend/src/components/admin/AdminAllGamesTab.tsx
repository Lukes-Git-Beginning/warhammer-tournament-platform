import { Fragment, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { getMetaGames, getFactions, getMaps, editGame } from '@/lib/api';
import type { GameHistoryEntry } from '@rizzotto/types';
import { formatInUserTimezone } from '@/lib/timezone';

const PAGE_SIZE = 50;
const selectClass =
  'rounded border border-rizzotto-iron-700 bg-rizzotto-iron-950 px-1.5 py-1 text-xs text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none max-w-[10rem]';

type EditBody = Parameters<typeof editGame>[2];

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

  const { data, isLoading } = useQuery({
    queryKey: ['admin-all-games', page],
    queryFn: () => getMetaGames(page, PAGE_SIZE),
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
      void queryClient.invalidateQueries({ queryKey: ['meta-games'] });
      void queryClient.invalidateQueries({ queryKey: ['factions'] });
    },
    onError: (err: Error, { game }) => {
      setRowError((e) => ({ ...e, [game.id]: err.message }));
      void queryClient.invalidateQueries({ queryKey: ['admin-all-games', page] });
    },
    onSettled: () => setSavingId(null),
  });

  const games = data?.games ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const save = (game: GameHistoryEntry, body: EditBody) => mutation.mutate({ game, body });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold text-rizzotto-gold-500">
          All Games <span className="ml-2 text-sm font-normal text-stone-500">({total} total)</span>
        </h2>
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

      <p className="mb-3 text-xs text-stone-500">
        Inline-edit factions, map and winner. Changing a winner that would flip the match
        result is rejected — use the match-result editor for that.
      </p>

      {isLoading && (
        <div className="flex justify-center py-8">
          <span className="h-6 w-6 rounded-full border-2 border-rizzotto-gold-400 border-t-transparent animate-spin" />
        </div>
      )}

      {!isLoading && (
        <div className="overflow-x-auto rounded-md border border-stone-800">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-stone-800 bg-stone-900/60 text-left">
                <th className="px-3 py-2 font-medium text-stone-400">Game ID</th>
                <th className="px-3 py-2 font-medium text-stone-400">Date</th>
                <th className="px-3 py-2 font-medium text-stone-400">Tournament</th>
                <th className="px-3 py-2 font-medium text-stone-400">R·G</th>
                <th className="px-3 py-2 font-medium text-stone-400">Player 1</th>
                <th className="px-3 py-2 font-medium text-stone-400">Faction</th>
                <th className="px-3 py-2 font-medium text-stone-400">Player 2</th>
                <th className="px-3 py-2 font-medium text-stone-400">Faction</th>
                <th className="px-3 py-2 font-medium text-stone-400">Map</th>
                <th className="px-3 py-2 font-medium text-stone-400">Winner</th>
                <th className="px-3 py-2 font-medium text-stone-400">Lb</th>
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
                        {g.countsForLeaderboard === false
                          ? <span className="text-stone-600">no</span>
                          : <span className="text-emerald-500/70">yes</span>}
                      </td>
                    </tr>
                    {rowError[g.id] && (
                      <tr>
                        <td colSpan={11} className="px-3 pb-2 text-xs text-red-400">{rowError[g.id]}</td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {games.length === 0 && (
                <tr><td colSpan={11} className="px-3 py-6 text-center text-stone-500 text-sm">No games.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
