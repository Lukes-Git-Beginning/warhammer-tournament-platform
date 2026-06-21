import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAdminScheduledMatchups, adminCancelScheduledMatchup, type AdminScheduledMatchup } from '@/lib/api';
import { formatInUserTimezone } from '@/lib/timezone';

type StatusFilter = 'ALL' | 'OPEN' | 'ACCEPTED' | 'EXPIRED' | 'CANCELLED';

const STATUS_BADGE: Record<AdminScheduledMatchup['status'], string> = {
  OPEN:      'bg-emerald-900/40 text-emerald-400 border-emerald-800',
  ACCEPTED:  'bg-blue-900/40 text-blue-400 border-blue-800',
  EXPIRED:   'bg-stone-800 text-stone-500 border-stone-700',
  CANCELLED: 'bg-red-900/30 text-red-500 border-red-900',
};

function PlayerCell({ player }: { player: { id: string; username: string; avatar_url: string | null } | null }) {
  if (!player) return <span className="text-stone-600">—</span>;
  return (
    <Link to="/users/$id" params={{ id: player.id }} className="flex items-center gap-1.5 hover:text-rizzotto-gold-400 transition-colors">
      {player.avatar_url
        ? <img src={player.avatar_url} alt="" className="h-5 w-5 rounded-full border border-stone-700 object-cover" />
        : <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-stone-700 text-[9px] text-stone-300">{player.username[0]?.toUpperCase()}</span>
      }
      <span className="text-sm text-stone-200">{player.username}</span>
    </Link>
  );
}

export function AdminScheduledMatchupsTab() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-scheduled-matchups', statusFilter, page],
    queryFn: () =>
      getAdminScheduledMatchups({
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        page,
      }),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => adminCancelScheduledMatchup(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-scheduled-matchups'] }),
    onError: (err: Error) => alert(`Cancel failed: ${err.message}`),
  });

  const filters: StatusFilter[] = ['ALL', 'OPEN', 'ACCEPTED', 'EXPIRED', 'CANCELLED'];
  const PAGE_SIZE = 30;
  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  return (
    <div className="space-y-4">
      {/* Status filter */}
      <div className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => { setStatusFilter(f); setPage(1); }}
            className={`rounded border px-3 py-1 text-xs font-medium uppercase tracking-wider transition-colors ${
              statusFilter === f
                ? 'border-rizzotto-gold-500 bg-rizzotto-gold-500/10 text-rizzotto-gold-400'
                : 'border-stone-700 text-stone-500 hover:border-stone-500 hover:text-stone-300'
            }`}
          >
            {f}
          </button>
        ))}
        <span className="ml-auto self-center text-xs text-stone-600">
          {data ? `${data.total} total` : ''}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-md border border-stone-800">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-stone-800 bg-stone-900/60">
              <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wider text-stone-500">Proposer</th>
              <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wider text-stone-500">Accepted By</th>
              <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wider text-stone-500">Format</th>
              <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wider text-stone-500">Proposed At</th>
              <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wider text-stone-500">Expires</th>
              <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wider text-stone-500">Status</th>
              <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wider text-stone-500">Notes</th>
              <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wider text-stone-500">Match</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-800/60">
            {isLoading && (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-sm text-stone-500">Loading…</td>
              </tr>
            )}
            {!isLoading && (data?.matchups.length ?? 0) === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-sm text-stone-600">No challenges found.</td>
              </tr>
            )}
            {(data?.matchups ?? []).map((m) => (
              <tr key={m.id} className="hover:bg-stone-800/20 transition-colors">
                <td className="px-4 py-2"><PlayerCell player={m.proposer} /></td>
                <td className="px-4 py-2"><PlayerCell player={m.accepted_by} /></td>
                <td className="px-4 py-2 text-xs font-mono text-stone-400">{m.format}</td>
                <td className="px-4 py-2 text-xs text-stone-400 whitespace-nowrap">
                  {formatInUserTimezone(m.proposed_at, 'dd MMM yyyy HH:mm')}
                </td>
                <td className="px-4 py-2 text-xs text-stone-500 whitespace-nowrap">
                  {formatInUserTimezone(m.expires_at, 'dd MMM HH:mm')}
                </td>
                <td className="px-4 py-2">
                  <span className={`inline-block rounded border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider ${STATUS_BADGE[m.status]}`}>
                    {m.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-xs text-stone-500 max-w-[180px] truncate">
                  {m.notes ?? <span className="text-stone-700">—</span>}
                </td>
                <td className="px-4 py-2">
                  {m.match_id ? (
                    <Link to="/matches/$matchId" params={{ matchId: m.match_id }} className="text-xs text-rizzotto-gold-400/70 hover:text-rizzotto-gold-400 transition-colors">
                      View →
                    </Link>
                  ) : <span className="text-stone-700">—</span>}
                </td>
                <td className="px-4 py-2 text-right">
                  {(m.status === 'OPEN' || m.status === 'ACCEPTED') && (
                    <button
                      type="button"
                      disabled={cancelMutation.isPending}
                      onClick={() => { if (confirm(`Cancel this ${m.status} challenge?`)) cancelMutation.mutate(m.id); }}
                      className="rounded border border-red-900/60 px-2 py-0.5 text-[10px] text-red-500/70 hover:border-red-700 hover:text-red-400 transition-colors disabled:opacity-40"
                    >
                      Cancel
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="rounded border border-stone-700 px-3 py-1 text-xs text-stone-400 disabled:opacity-40 hover:border-stone-500">
            ← Prev
          </button>
          <span className="text-xs text-stone-500">{page} / {totalPages}</span>
          <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="rounded border border-stone-700 px-3 py-1 text-xs text-stone-400 disabled:opacity-40 hover:border-stone-500">
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
