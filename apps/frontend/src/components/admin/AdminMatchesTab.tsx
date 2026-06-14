import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAdminMatches, voidMatch, type AdminMatchRow } from '@/lib/api';

const STATUS_BADGE: Record<string, string> = {
  COMPLETED:  'bg-emerald-900/40 text-emerald-300',
  FORFEIT:    'bg-red-900/40 text-red-300',
  BYE:        'bg-stone-700/60 text-stone-400',
  CANCELLED:  'bg-stone-800/60 text-stone-500',
};

const FORMAT_LABELS: Record<string, string> = {
  SWISS: 'Swiss',
  AUTO_SWISS: 'Auto Swiss',
  SINGLE_ELIMINATION: 'SE',
  DOUBLE_ELIMINATION: 'DE',
  LIECHTENSTEIN: 'RR',
};

function VoidButton({ match }: { match: AdminMatchRow }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (isVoid: boolean) => voidMatch(match.id, isVoid),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-matches'] }),
  });
  const isVoided = !match.countsForLeaderboard;
  return (
    <button
      type="button"
      disabled={mutation.isPending}
      onClick={() => mutation.mutate(!isVoided)}
      className={`rounded border px-2 py-0.5 text-[10px] font-semibold transition-colors disabled:opacity-40 ${
        isVoided
          ? 'border-emerald-700 text-emerald-300 hover:bg-emerald-900/20'
          : 'border-amber-700 text-amber-500 hover:bg-amber-900/20'
      }`}
    >
      {isVoided ? 'Restore' : 'Exclude'}
    </button>
  );
}

const PAGE_SIZE = 50;

export function AdminMatchesTab() {
  const [page, setPage] = useState(1);
  const [showVoidedOnly, setShowVoidedOnly] = useState(false);
  const [search, setSearch] = useState('');

  const filters = {
    voided: showVoidedOnly ? true : undefined,
    search: search.length >= 2 ? search : undefined,
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-matches', page, filters],
    queryFn: () => getAdminMatches(page, filters),
  });

  const matches = data?.matches ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div>
      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search player…"
          className="rounded border border-stone-700 bg-stone-900 px-3 py-1.5 text-sm text-stone-200 placeholder:text-stone-500 focus:border-rizzotto-gold-500 focus:outline-none w-48"
        />
        <label className="flex items-center gap-2 text-sm text-stone-300 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showVoidedOnly}
            onChange={(e) => { setShowVoidedOnly(e.target.checked); setPage(1); }}
            className="accent-amber-500"
          />
          Show excluded only
        </label>
        {data && (
          <span className="text-xs text-stone-500 ml-auto">
            {total} match{total !== 1 ? 'es' : ''}
          </span>
        )}
      </div>

      {isLoading && <div className="py-8 text-center text-stone-400 text-sm">Loading…</div>}
      {error && (
        <div className="rounded-md border border-red-900 bg-red-950/40 p-4 text-red-300 text-sm">
          Failed to load matches.
        </div>
      )}

      {!isLoading && !error && (
        <>
          <div className="overflow-x-auto rounded-md border border-stone-800">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-stone-800 bg-stone-900/60">
                  <th className="px-3 py-3 text-left font-medium text-stone-400">Tournament</th>
                  <th className="px-3 py-3 text-left font-medium text-stone-400">Round</th>
                  <th className="px-3 py-3 text-left font-medium text-stone-400">Player 1</th>
                  <th className="px-3 py-3 text-left font-medium text-stone-400">Player 2</th>
                  <th className="px-3 py-3 text-left font-medium text-stone-400">Winner</th>
                  <th className="px-3 py-3 text-left font-medium text-stone-400">Status</th>
                  <th className="px-3 py-3 text-left font-medium text-stone-400">Date</th>
                  <th className="px-3 py-3 text-left font-medium text-stone-400">Leaderboard</th>
                  <th className="px-3 py-3 text-left font-medium text-stone-400">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-800/60">
                {matches.map((m) => {
                  const isVoided = !m.countsForLeaderboard;
                  return (
                    <tr
                      key={m.id}
                      className={`transition-colors hover:bg-stone-800/20 ${isVoided ? 'bg-amber-950/10' : ''}`}
                    >
                      <td className="px-3 py-2 max-w-[160px]">
                        {m.tournament ? (
                          <div className="flex flex-col gap-0.5">
                            <Link
                              to="/tournaments/$slug"
                              params={{ slug: m.tournament.slug }}
                              className="text-xs text-stone-200 hover:text-rizzotto-gold-400 transition-colors truncate block"
                            >
                              {m.tournament.name}
                            </Link>
                            <span className="text-[10px] text-stone-600">
                              {FORMAT_LABELS[m.tournament.format] ?? m.tournament.format}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-stone-600">Open Play</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-stone-400 whitespace-nowrap">
                        R{m.round}·M{m.matchNumber}
                      </td>
                      <td className="px-3 py-2">
                        {m.player1 ? (
                          <Link to="/users/$id" params={{ id: m.player1.id }} className="text-xs text-stone-200 hover:text-rizzotto-gold-400 transition-colors">
                            {m.player1.username}
                          </Link>
                        ) : <span className="text-stone-600">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        {m.player2 ? (
                          <Link to="/users/$id" params={{ id: m.player2.id }} className="text-xs text-stone-200 hover:text-rizzotto-gold-400 transition-colors">
                            {m.player2.username}
                          </Link>
                        ) : <span className="text-stone-600">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        {m.result === 'DRAW' ? (
                          <span className="text-xs text-amber-400">Draw</span>
                        ) : m.winner ? (
                          <Link to="/users/$id" params={{ id: m.winner.id }} className="text-xs text-rizzotto-gold-400 hover:underline">
                            {m.winner.username}
                          </Link>
                        ) : (
                          <span className="text-stone-600 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_BADGE[m.status] ?? 'text-stone-500'}`}>
                          {m.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-stone-500 whitespace-nowrap">
                        {m.playedAt
                          ? new Date(m.playedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                          : '—'}
                      </td>
                      <td className="px-3 py-2">
                        {isVoided ? (
                          <span className="text-[10px] text-amber-500 font-semibold">⚠ Excluded</span>
                        ) : (
                          <span className="text-[10px] text-emerald-400">✓ Counted</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <Link
                            to="/matches/$matchId"
                            params={{ matchId: m.id }}
                            className="rounded border border-stone-700 px-2 py-0.5 text-[10px] text-stone-400 hover:text-stone-200 hover:border-stone-500 transition-colors"
                          >
                            View
                          </Link>
                          <VoidButton match={m} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {matches.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-stone-500">
                      No matches found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm text-stone-400">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="rounded border border-stone-700 px-3 py-1 hover:border-stone-500 disabled:opacity-40 transition-colors"
              >
                ← Previous
              </button>
              <span>Page {page} / {totalPages}</span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded border border-stone-700 px-3 py-1 hover:border-stone-500 disabled:opacity-40 transition-colors"
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
