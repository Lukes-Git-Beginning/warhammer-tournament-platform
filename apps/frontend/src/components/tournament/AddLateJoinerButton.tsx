import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { searchTeammates, getAllTeams, addLateJoiner } from '@/lib/api';

/**
 * Host tool: add a late joiner by searching for them by name, instead of pasting a raw id.
 * Mirrors the co-host search picker. The panel stays open after a successful add so the host
 * can add several in a row.
 *
 * 1v1: searches USERS and adds a user. 2v2 (team-as-actor): a late competitor is a whole ACTIVE
 * TEAM — the picker searches teams and adds the team (the backend seeds the captain's participant
 * row with team_id + a CATCHUP_BYE for the current round).
 */
export function AddLateJoinerButton({ slug, competitorFormat }: { slug: string; competitorFormat?: 'ONE_V_ONE' | 'TWO_V_TWO' }) {
  const queryClient = useQueryClient();
  const is2v2 = competitorFormat === 'TWO_V_TWO';
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [lastAdded, setLastAdded] = useState<string | null>(null);

  // 1v1: user search. 2v2: pull the team directory once, filter to ACTIVE teams by name client-side.
  const { data: userData } = useQuery({
    queryKey: ['late-joiner-search', search],
    queryFn: () => searchTeammates(search),
    enabled: open && !is2v2 && search.trim().length >= 2,
    staleTime: 30_000,
  });
  const { data: teamData } = useQuery({
    queryKey: ['all-teams'],
    queryFn: () => getAllTeams(),
    enabled: open && is2v2,
    staleTime: 60_000,
  });

  const userCandidates = userData?.users ?? [];
  const q = search.trim().toLowerCase();
  const teamCandidates = (teamData?.teams ?? [])
    .filter((t) => t.status === 'ACTIVE' && t.name.toLowerCase().includes(q))
    .slice(0, 20);

  const addMutation = useMutation({
    mutationFn: (target: { userId?: string; teamId?: string }) => addLateJoiner(slug, target),
    onSuccess: (result) => {
      setLastAdded(result.participant?.team?.name ?? result.participant?.user?.username ?? 'Competitor');
      setSearch('');
      void queryClient.invalidateQueries({ queryKey: ['tournament', slug] });
      void queryClient.invalidateQueries({ queryKey: ['tournament-participants', slug] });
      void queryClient.invalidateQueries({ queryKey: ['bracket', slug] });
    },
  });

  function close() {
    setOpen(false);
    setSearch('');
    setLastAdded(null);
  }

  const showResults = is2v2 ? q.length >= 1 : q.length >= 2;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        className="rounded border border-rizzotto-gold-500/40 px-3 py-1.5 text-sm text-rizzotto-gold-400 hover:border-rizzotto-gold-400 hover:text-rizzotto-gold-300 transition-colors"
      >
        {is2v2 ? '+ Add Late Team' : '+ Add Late Joiner'}
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 w-72 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900 p-2 shadow-lg">
          <input
            type="text"
            autoFocus
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setLastAdded(null);
            }}
            placeholder={is2v2 ? 'Search teams to add…' : 'Search players to add…'}
            className="w-full rounded-md border border-rizzotto-iron-600 bg-rizzotto-iron-800 px-3 py-2 text-sm text-rizzotto-stone-200 placeholder-rizzotto-stone-500 focus:outline-none focus:ring-1 focus:ring-rizzotto-gold-400"
          />
          {showResults && (
            <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900">
              {is2v2 ? (
                teamCandidates.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-rizzotto-stone-500">No matching active teams.</p>
                ) : (
                  teamCandidates.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => addMutation.mutate({ teamId: t.id })}
                      disabled={addMutation.isPending}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rizzotto-stone-200 transition-colors hover:bg-rizzotto-iron-800 disabled:opacity-50"
                    >
                      <span className="truncate">{t.name}</span>
                      <span className="ml-auto shrink-0 text-xs text-rizzotto-stone-500">
                        {t.members.map((m) => m.username).join(' & ')}
                      </span>
                    </button>
                  ))
                )
              ) : userCandidates.length === 0 ? (
                <p className="px-3 py-2 text-xs text-rizzotto-stone-500">No matching players.</p>
              ) : (
                userCandidates.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => addMutation.mutate({ userId: u.id })}
                    disabled={addMutation.isPending}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rizzotto-stone-200 transition-colors hover:bg-rizzotto-iron-800 disabled:opacity-50"
                  >
                    {u.avatar_url && <img src={u.avatar_url} alt="" className="h-6 w-6 rounded-full" />}
                    <span>{u.username}</span>
                  </button>
                ))
              )}
            </div>
          )}
          {addMutation.isError && (
            <p className="mt-1 px-1 text-xs text-red-400">{(addMutation.error as Error).message}</p>
          )}
          {lastAdded && !addMutation.isError && (
            <p className="mt-1 px-1 text-xs text-rizzotto-success">Added {lastAdded}. Search for another or close.</p>
          )}
          <button
            type="button"
            onClick={close}
            className="mt-1 px-1 text-xs text-rizzotto-stone-500 hover:text-rizzotto-stone-300 transition-colors"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}
