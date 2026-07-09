import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getJoinRequests, approveJoinRequest, declineJoinRequest, getFactions } from '@/lib/api';

/**
 * Host-only panel listing pending late-join requests with Admit / Decline buttons.
 * Rendered at the TournamentDetail level (above the live view) so it stays visible
 * regardless of whether the participants list, standings or bracket is shown.
 * Renders nothing when there are no pending requests.
 */
export function LateJoinRequestsPanel({ slug }: { slug: string }) {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['join-requests', slug],
    queryFn: () => getJoinRequests(slug),
    retry: false,
    refetchInterval: 30_000,
  });
  const { data: factionsResp } = useQuery({
    queryKey: ['factions'],
    queryFn: () => getFactions(),
    staleTime: 5 * 60_000,
  });
  const factionName = (id: string | null) =>
    id ? (factionsResp?.data.find((d) => d.faction.id === id)?.faction.name ?? id) : null;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['join-requests', slug] });
    void queryClient.invalidateQueries({ queryKey: ['tournament-participants', slug] });
    void queryClient.invalidateQueries({ queryKey: ['bracket', slug] });
  };
  const approve = useMutation({
    mutationFn: (userId: string) => approveJoinRequest(slug, userId),
    onSuccess: invalidate,
  });
  const decline = useMutation({
    mutationFn: (userId: string) => declineJoinRequest(slug, userId),
    onSuccess: invalidate,
  });

  const requests = data?.requests ?? [];
  if (requests.length === 0) return null;

  return (
    <section className="mb-6 rounded-lg border border-rizzotto-gold-700/50 bg-rizzotto-gold-500/5 p-4">
      <h3 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold text-rizzotto-gold-400">
        Late-join requests
        <span className="rounded-full bg-rizzotto-gold-500/20 px-2 py-0.5 text-xs font-medium text-rizzotto-gold-300">
          {requests.length}
        </span>
      </h3>
      <ul className="space-y-2">
        {requests.map((r) => {
          const pendingApprove = approve.isPending && approve.variables === r.user_id;
          const busy = pendingApprove || (decline.isPending && decline.variables === r.user_id);
          const fname = factionName(r.faction_id);
          return (
            <li
              key={r.user_id}
              className="flex items-center justify-between gap-3 rounded border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-2">
                {r.user.avatar_url ? (
                  <img
                    src={r.user.avatar_url}
                    alt={r.user.username}
                    className="h-7 w-7 shrink-0 rounded-full border border-stone-700 object-cover"
                  />
                ) : (
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-stone-700 text-xs font-medium text-stone-200">
                    {r.user.username[0]?.toUpperCase() ?? '?'}
                  </span>
                )}
                <div className="min-w-0">
                  <div className="truncate text-sm text-stone-200">{r.user.username}</div>
                  <div className="flex flex-wrap gap-x-3 text-[11px] text-stone-500">
                    {fname && (
                      <span>
                        Faction: <span className="text-stone-400">{fname}</span>
                      </span>
                    )}
                    {r.requested_band != null && (
                      <span>
                        Band: <span className="text-stone-400">{r.requested_band}</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => approve.mutate(r.user_id)}
                  className="rounded border border-emerald-700 px-2.5 py-1 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-900/30 disabled:opacity-40"
                >
                  {pendingApprove ? 'Admitting…' : 'Admit'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => decline.mutate(r.user_id)}
                  className="rounded border border-red-800 px-2.5 py-1 text-xs font-semibold text-red-400 transition-colors hover:bg-red-950/50 disabled:opacity-40"
                >
                  Decline
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
