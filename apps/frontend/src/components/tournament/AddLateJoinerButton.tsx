import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { searchTeammates, addLateJoiner } from '@/lib/api';

/**
 * Host tool: add a late joiner by searching for the player by name, instead of pasting a raw
 * User ID. Mirrors the co-host search picker. The panel stays open after a successful add so the
 * host can add several players in a row.
 */
export function AddLateJoinerButton({ slug }: { slug: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [lastAdded, setLastAdded] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ['late-joiner-search', search],
    queryFn: () => searchTeammates(search),
    enabled: open && search.trim().length >= 2,
    staleTime: 30_000,
  });
  const candidates = data?.users ?? [];

  const addMutation = useMutation({
    mutationFn: (userId: string) => addLateJoiner(slug, userId),
    onSuccess: (result) => {
      setLastAdded(result.participant?.user?.username ?? 'Player');
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

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        className="rounded border border-rizzotto-gold-500/40 px-3 py-1.5 text-sm text-rizzotto-gold-400 hover:border-rizzotto-gold-400 hover:text-rizzotto-gold-300 transition-colors"
      >
        + Add Late Joiner
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
            placeholder="Search players to add…"
            className="w-full rounded-md border border-rizzotto-iron-600 bg-rizzotto-iron-800 px-3 py-2 text-sm text-rizzotto-stone-200 placeholder-rizzotto-stone-500 focus:outline-none focus:ring-1 focus:ring-rizzotto-gold-400"
          />
          {search.trim().length >= 2 && (
            <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900">
              {candidates.length === 0 ? (
                <p className="px-3 py-2 text-xs text-rizzotto-stone-500">No matching players.</p>
              ) : (
                candidates.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => addMutation.mutate(u.id)}
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
