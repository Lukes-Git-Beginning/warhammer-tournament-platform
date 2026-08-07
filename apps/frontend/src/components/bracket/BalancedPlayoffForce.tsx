import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { PlayoffPreviewDivision } from '@rizzotto/types';
import { getBalancedPlayoffPreview, startPlayoffs } from '@/lib/api';

/**
 * Host tool (Balanced Liechtenstein): force a single division's playoff bracket early, seeded from
 * the CURRENT standings — bypassing the wait for every borrowed band to finish. Lives under the
 * playoff plan preview. Each not-yet-generated division shows its seeds + a readiness verdict; a
 * blocked division warns which players are still playing and requires an explicit override, then a
 * second confirmation, before it generates (Alex-spec: double confirm + warning + override).
 *
 * Only rendered for hosts/co-hosts of an ongoing BaLi tournament. Renders nothing when there is
 * nothing left to force (all divisions already generated).
 */
export function BalancedPlayoffForce({ tournamentId, slug }: { tournamentId: string; slug: string }) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<PlayoffPreviewDivision | null>(null);
  const [overrideAck, setOverrideAck] = useState(false);
  const [confirmStage, setConfirmStage] = useState<1 | 2>(1);

  const { data, isLoading } = useQuery({
    queryKey: ['balanced-playoff-preview', tournamentId],
    queryFn: () => getBalancedPlayoffPreview(tournamentId),
    staleTime: 10_000,
  });

  const force = useMutation({
    mutationFn: (band: number) => startPlayoffs(tournamentId, [band]),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bracket', slug] });
      void queryClient.invalidateQueries({ queryKey: ['bracket'] });
      void queryClient.invalidateQueries({ queryKey: ['balanced-playoff-preview', tournamentId] });
      closeDialog();
    },
  });

  function closeDialog() {
    setPending(null);
    setOverrideAck(false);
    setConfirmStage(1);
  }

  if (isLoading || !data) return null;
  const forceable = data.divisions.filter((d) => !d.alreadyGenerated);
  if (forceable.length === 0) return null;

  const label = (d: PlayoffPreviewDivision) => `${d.format.replace('TOP', 'Top ')} · ${d.size} seeds`;

  return (
    <div className="mb-4 rounded-md border border-dashed border-amber-800/50 bg-stone-950/40 p-4">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-wider text-amber-600/90">Host tool · Force division playoffs</span>
      </div>
      <p className="mb-3 text-xs text-stone-500">
        Generate a single division early, seeded from the current standings. Ready divisions generate
        on their own within a minute — force is for a division still waiting on other bands, or one
        that failed to generate on its own.
      </p>
      <div className="flex flex-col gap-2">
        {forceable.map((d) => (
          <div
            key={d.band}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-stone-700/70 bg-stone-900/60 px-3 py-2"
          >
            <span className="text-sm font-medium text-stone-200">Division {d.band}</span>
            <span className="text-xs text-stone-500">{label(d)}</span>
            {d.ready ? (
              <span className="rounded bg-emerald-900/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-400">
                Ready
              </span>
            ) : (
              <span className="rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-400">
                {d.blockers.length} still playing
              </span>
            )}
            <span className="w-full text-xs text-stone-500">
              Seeds: {d.seeds.map((s) => s.username).join(', ')}
            </span>
            <button
              type="button"
              onClick={() => {
                setPending(d);
                setOverrideAck(false);
                setConfirmStage(1);
              }}
              className="ml-auto rounded border border-amber-600/60 px-3 py-1 text-xs font-medium text-amber-400 transition-colors hover:bg-amber-600/10"
            >
              Force generate
            </button>
          </div>
        ))}
      </div>

      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-lg border border-stone-700 bg-stone-950 p-5 shadow-xl">
            <h3 className="mb-2 text-base font-semibold text-stone-100">
              Force Division {pending.band} playoff?
            </h3>
            <p className="mb-3 text-sm text-stone-400">
              This generates the <span className="text-stone-200">{label(pending)}</span> bracket now,
              seeded from the current standings. Seeds:{' '}
              <span className="text-stone-300">{pending.seeds.map((s) => s.username).join(', ')}</span>.
            </p>

            {pending.blockers.length > 0 && (
              <div className="mb-3 rounded border border-amber-800/50 bg-amber-950/30 p-3">
                <p className="mb-1 text-xs font-medium text-amber-400">
                  Warning — {pending.blockers.length}{' '}
                  {pending.blockers.length === 1 ? 'player is' : 'players are'} still playing:
                </p>
                <p className="mb-2 text-xs text-amber-200/80">
                  {pending.blockers.map((b) => b.username).join(', ')}
                </p>
                <p className="mb-2 text-[11px] text-stone-500">
                  Their remaining results can still change this division's membership and seeding.
                  Forcing now freezes it as it stands.
                </p>
                <label className="flex items-start gap-2 text-xs text-stone-300">
                  <input
                    type="checkbox"
                    checked={overrideAck}
                    onChange={(e) => setOverrideAck(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>I understand and want to override the completeness check.</span>
                </label>
              </div>
            )}

            {force.isError && (
              <p className="mb-2 text-sm text-red-400">Error: {(force.error as Error).message}</p>
            )}

            {confirmStage === 1 ? (
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeDialog}
                  className="rounded border border-stone-700 px-3 py-1.5 text-sm text-stone-400 hover:bg-stone-800/50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={pending.blockers.length > 0 && !overrideAck}
                  onClick={() => setConfirmStage(2)}
                  className="rounded border border-amber-600/60 px-3 py-1.5 text-sm font-medium text-amber-400 hover:bg-amber-600/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Continue
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-end gap-2">
                <span className="mr-auto text-xs text-stone-500">Are you sure? This cannot be easily undone.</span>
                <button
                  type="button"
                  onClick={() => setConfirmStage(1)}
                  className="rounded border border-stone-700 px-3 py-1.5 text-sm text-stone-400 hover:bg-stone-800/50"
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={force.isPending}
                  onClick={() => force.mutate(pending.band)}
                  className="rounded border border-amber-600/60 bg-amber-600/10 px-3 py-1.5 text-sm font-medium text-amber-300 hover:bg-amber-600/20 disabled:opacity-50"
                >
                  {force.isPending ? 'Generating…' : 'Yes, generate now'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
