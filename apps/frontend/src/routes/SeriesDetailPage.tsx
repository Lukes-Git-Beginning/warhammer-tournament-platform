import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from '@tanstack/react-router';
import {
  getSeries,
  listTournaments,
  patchSeries,
  attachToSeries,
  detachFromSeries,
  seedFinal,
  pauseSeries,
  uploadSeriesPoster,
  getSeriesCoHosts,
  searchSeriesCoHostCandidates,
  addSeriesCoHost,
  removeSeriesCoHost,
  transferSeriesOwner,
  type Series,
  type StandingA,
  type QualifiedC,
  type CoHostUser,
} from '@/lib/api.js';
import { PageShell } from '@/components/layout/PageShell.js';
import { Badge } from '@/components/ui/badge.js';
import { Skeleton } from '@/components/ui/skeleton.js';
import { Button } from '@/components/ui/button.js';
import { PosterUploadField } from '@/components/tournament/PosterUploadField.js';

// ---------------------------------------------------------------------------
// Standings table (model A — points race)
// ---------------------------------------------------------------------------

function StandingsTable({
  standings,
  finalSize,
  provisional,
}: {
  standings: StandingA[];
  finalSize: number;
  provisional: boolean;
}) {
  const cutoffIndex = finalSize; // rows 0..finalSize-1 qualify

  return (
    <div>
      {provisional && (
        <p className="mb-3 text-xs text-rizzotto-stone-400 italic">
          Provisional — qualifiers still to come. Standings will update as events complete.
        </p>
      )}
      <div className="overflow-x-auto rounded border border-rizzotto-iron-700">
        <table className="w-full text-sm">
          <thead className="bg-rizzotto-iron-800">
            <tr>
              <th className="px-3 py-2 text-left font-semibold text-rizzotto-stone-300 w-10">#</th>
              <th className="px-3 py-2 text-left font-semibold text-rizzotto-stone-300">Player</th>
              <th className="px-3 py-2 text-right font-semibold text-rizzotto-stone-300 font-mono">Pts</th>
              <th className="px-3 py-2 text-right font-semibold text-rizzotto-stone-300 font-mono">GP</th>
              <th className="px-3 py-2 text-right font-semibold text-rizzotto-stone-300 font-mono">GW</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((row, idx) => {
              const isQualified = row.qualified;
              const isCutoff = idx === cutoffIndex;
              return (
                <tr
                  key={row.competitorId}
                  className={[
                    isCutoff ? 'border-t-2 border-rizzotto-gold-500/60' : '',
                    isQualified
                      ? 'bg-rizzotto-gold-500/10 border-t border-rizzotto-iron-700'
                      : 'border-t border-rizzotto-iron-800',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <td className="px-3 py-2 text-rizzotto-stone-500 font-mono text-xs">
                    {row.rank}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {row.avatar_url && (
                        <img
                          src={row.avatar_url}
                          alt=""
                          className="size-6 rounded-full"
                          loading="lazy"
                        />
                      )}
                      <Link
                        to="/users/$id"
                        params={{ id: row.competitorId }}
                        className="text-rizzotto-stone-200 hover:text-rizzotto-gold-400 transition-colors"
                      >
                        {row.username}
                      </Link>
                      {isQualified && (
                        <Badge variant="gold" className="text-xs py-0 px-1.5">
                          Qualified
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-rizzotto-stone-200">
                    {row.points}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-rizzotto-stone-400">
                    {row.gamesPlayed}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-rizzotto-stone-400">
                    {row.wins}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Qualified list (model C — per-qualifier)
// ---------------------------------------------------------------------------

function QualifiedList({
  qualified,
  qualifierSlugById,
}: {
  qualified: QualifiedC[];
  qualifierSlugById: Map<string, string>;
}) {
  if (qualified.length === 0) {
    return <p className="text-sm text-rizzotto-stone-500">No qualifiers locked in yet.</p>;
  }

  return (
    <div className="overflow-x-auto rounded border border-rizzotto-iron-700">
      <table className="w-full text-sm">
        <thead className="bg-rizzotto-iron-800">
          <tr>
            <th className="px-3 py-2 text-left font-semibold text-rizzotto-stone-300">Seed</th>
            <th className="px-3 py-2 text-left font-semibold text-rizzotto-stone-300">Player</th>
            <th className="px-3 py-2 text-left font-semibold text-rizzotto-stone-300">From</th>
            <th className="px-3 py-2 text-right font-semibold text-rizzotto-stone-300 font-mono">Pos.</th>
          </tr>
        </thead>
        <tbody>
          {[...qualified].sort((a, b) => a.seed - b.seed).map((row) => {
            const qSlug = qualifierSlugById.get(row.fromTournamentId);
            return (
              <tr key={`${row.competitorId}-${row.fromTournamentId}`} className="border-t border-rizzotto-iron-800">
                <td className="px-3 py-2 font-mono text-rizzotto-gold-400">{row.seed}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    {row.avatar_url && (
                      <img
                        src={row.avatar_url}
                        alt=""
                        className="size-6 rounded-full"
                        loading="lazy"
                      />
                    )}
                    <Link
                      to="/users/$id"
                      params={{ id: row.competitorId }}
                      className="text-rizzotto-stone-200 hover:text-rizzotto-gold-400 transition-colors"
                    >
                      {row.username}
                    </Link>
                  </div>
                </td>
                <td className="px-3 py-2">
                  {qSlug ? (
                    <Link
                      to="/tournaments/$slug"
                      params={{ slug: qSlug }}
                      className="text-rizzotto-gold-400 hover:text-rizzotto-gold-300 underline underline-offset-2 text-sm"
                    >
                      View qualifier
                    </Link>
                  ) : (
                    <span className="text-rizzotto-stone-500 text-xs">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-mono text-rizzotto-stone-400">
                  {row.position}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Seed-final panel (model A/C only)
// ---------------------------------------------------------------------------

function SeedFinalPanel({ series, seriesSlug }: { series: Series; seriesSlug: string }) {
  const queryClient = useQueryClient();

  const seedMutation = useMutation({
    mutationFn: () => seedFinal(seriesSlug),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['series', seriesSlug] });
    },
  });

  if (series.final_seeded_at) {
    return (
      <div className="mt-4">
        <p className="text-sm text-rizzotto-stone-300">
          Final seeded ✓ —{' '}
          {series.final ? (
            <Link
              to="/tournaments/$slug"
              params={{ slug: series.final.slug }}
              className="text-rizzotto-gold-400 hover:text-rizzotto-gold-300 underline underline-offset-2"
            >
              open the final to start it
            </Link>
          ) : (
            'open the final to start it'
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-2">
      <button
        type="button"
        disabled={!series.ready_to_seed || seedMutation.isPending}
        title={
          series.ready_to_seed
            ? undefined
            : 'Available once every qualifier is completed.'
        }
        onClick={() => {
          if (
            window.confirm(
              'Lock standings and seed the final tournament with the qualified players? This cannot be undone.',
            )
          ) {
            seedMutation.mutate();
          }
        }}
        className="rounded border border-rizzotto-gold-500/60 px-4 py-2 text-sm font-semibold text-rizzotto-gold-400 hover:bg-rizzotto-gold-500/10 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
      >
        {seedMutation.isPending ? 'Seeding…' : 'Lock standings & seed final'}
      </button>
      {!series.ready_to_seed && (
        <p className="text-xs text-rizzotto-stone-600">
          Available once every qualifier is completed.
        </p>
      )}
      {seedMutation.isError && (
        <p className="text-xs text-red-400">{(seedMutation.error as Error).message}</p>
      )}
      {seedMutation.isSuccess && (
        <p className="text-xs text-rizzotto-gold-400">
          Final seeded successfully.{' '}
          {seedMutation.data.finalSlug && (
            <Link
              to="/tournaments/$slug"
              params={{ slug: seedMutation.data.finalSlug }}
              className="underline underline-offset-2"
            >
              Open the final
            </Link>
          )}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Series co-hosts section (mirrored 1:1 from tournament CoHostsSection)
// ---------------------------------------------------------------------------

function SeriesCoHostsSection({ seriesSlug }: { seriesSlug: string }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');

  const { data: coHosts = [] } = useQuery<CoHostUser[]>({
    queryKey: ['series-co-hosts', seriesSlug],
    queryFn: () => getSeriesCoHosts(seriesSlug),
  });
  const { data: candidates = [] } = useQuery<CoHostUser[]>({
    queryKey: ['series-co-host-candidates', seriesSlug, search],
    queryFn: () => searchSeriesCoHostCandidates(seriesSlug, search),
    enabled: search.trim().length >= 2,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['series-co-hosts', seriesSlug] });
    void queryClient.invalidateQueries({ queryKey: ['series-co-host-candidates', seriesSlug] });
    void queryClient.invalidateQueries({ queryKey: ['series', seriesSlug] });
  };

  const addMutation = useMutation({
    mutationFn: (userId: string) => addSeriesCoHost(seriesSlug, userId),
    onSuccess: () => {
      setSearch('');
      refresh();
    },
  });
  const removeMutation = useMutation({
    mutationFn: (userId: string) => removeSeriesCoHost(seriesSlug, userId),
    onSuccess: refresh,
  });

  return (
    <div className="border-t border-rizzotto-iron-700 pt-6 mt-6">
      <h3 className="text-sm font-semibold text-rizzotto-stone-300 mb-1">Co-hosts</h3>
      <p className="text-xs text-rizzotto-stone-500 mb-3">
        Co-hosts manage this series alongside you — except transferring ownership or editing this list.
      </p>

      {coHosts.length > 0 ? (
        <ul className="flex flex-col gap-2 mb-3">
          {coHosts.map((u) => (
            <li
              key={u.id}
              className="flex items-center gap-2 rounded bg-rizzotto-iron-800/60 px-3 py-2"
            >
              {u.avatar_url && <img src={u.avatar_url} alt="" className="h-6 w-6 rounded-full" />}
              <span className="flex-1 text-sm text-rizzotto-stone-200">{u.username}</span>
              <button
                type="button"
                onClick={() => removeMutation.mutate(u.id)}
                disabled={removeMutation.isPending}
                className="text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-rizzotto-stone-500 mb-3">No co-hosts yet.</p>
      )}

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
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
      {addMutation.isError && <p className="text-xs text-red-400 mt-2">Could not add co-host.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Transfer series owner section
// ---------------------------------------------------------------------------

function SeriesTransferOwnerSection({
  seriesSlug,
  series,
}: {
  seriesSlug: string;
  series: Series;
}) {
  const queryClient = useQueryClient();
  // Candidates: existing co-hosts are the natural transfer targets (owner/admin may also
  // know the user id directly). We reuse the co-host list for the dropdown.
  const { data: coHosts = [] } = useQuery<CoHostUser[]>({
    queryKey: ['series-co-hosts', seriesSlug],
    queryFn: () => getSeriesCoHosts(seriesSlug),
  });

  const [selectedId, setSelectedId] = useState('');

  const mutation = useMutation({
    mutationFn: (id: string) => transferSeriesOwner(seriesSlug, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['series', seriesSlug] });
    },
  });

  // Build the selectable list: co-hosts + any search results (fallback: empty)
  const options = coHosts.filter((u) => u.id !== series.owner.id);

  return (
    <div className="border-t border-rizzotto-iron-700 pt-6 mt-6">
      <h3 className="text-sm font-semibold text-rizzotto-stone-300 mb-3">Transfer Ownership</h3>
      {options.length === 0 ? (
        <p className="text-xs text-rizzotto-stone-500">
          Add a co-host first — only current co-hosts (who are HOST or ADMIN) can receive ownership.
        </p>
      ) : (
        <div className="flex gap-3 items-center">
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="flex-1 bg-rizzotto-iron-800 border border-rizzotto-iron-600 rounded px-3 py-2 text-sm text-rizzotto-stone-200"
          >
            <option value="">Select new owner…</option>
            {options.map((u) => (
              <option key={u.id} value={u.id}>
                {u.username}
              </option>
            ))}
          </select>
          <Button
            variant="etched"
            size="sm"
            disabled={!selectedId || mutation.isPending}
            onClick={() => {
              if (window.confirm(`Transfer series ownership to ${options.find((u) => u.id === selectedId)?.username ?? selectedId}? You will lose management access.`)) {
                mutation.mutate(selectedId);
              }
            }}
          >
            {mutation.isPending ? 'Transferring…' : 'Transfer'}
          </Button>
        </div>
      )}
      {mutation.isSuccess && <p className="text-xs text-green-400 mt-2">Ownership transferred.</p>}
      {mutation.isError && (
        <p className="text-xs text-red-400 mt-2">{(mutation.error as Error).message}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Poster upload section
// ---------------------------------------------------------------------------

function SeriesPosterSection({ seriesSlug, posterUrl }: { seriesSlug: string; posterUrl?: string | null }) {
  const queryClient = useQueryClient();
  return (
    <div className="mb-6">
      <PosterUploadField
        slug={seriesSlug}
        posterUrl={posterUrl}
        uploadFn={uploadSeriesPoster}
        legend="Series Poster"
        description="No poster set. Upload a banner image — shown on the series page and its card."
        onUploaded={() => void queryClient.invalidateQueries({ queryKey: ['series', seriesSlug] })}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Attach qualifier picker
// ---------------------------------------------------------------------------

function AttachQualifierPicker({
  seriesSlug,
  seriesId,
}: {
  seriesSlug: string;
  seriesId: string;
}) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState('');
  const [attachError, setAttachError] = useState<string | null>(null);

  const { data: tournamentsData, isLoading } = useQuery({
    queryKey: ['tournaments', 'manageable', 'not-in-series', seriesId],
    queryFn: () =>
      listTournaments(1, 50, undefined, undefined, {
        manageable: true,
        notInSeries: true,
        seriesExempt: seriesId,
      }),
  });
  const candidates = tournamentsData?.data ?? [];

  const attachMutation = useMutation({
    mutationFn: (tournamentId: string) => attachToSeries(seriesSlug, tournamentId),
    onSuccess: () => {
      setSelectedId('');
      setAttachError(null);
      void queryClient.invalidateQueries({ queryKey: ['series', seriesSlug] });
      void queryClient.invalidateQueries({ queryKey: ['tournaments', 'manageable', 'not-in-series', seriesId] });
    },
    onError: (err: Error) => setAttachError(err.message),
  });

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <label className="mb-1 block text-xs text-rizzotto-stone-400">
            Pick a tournament to attach as qualifier
          </label>
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            disabled={isLoading || candidates.length === 0}
            className="w-full rounded border border-rizzotto-iron-700 bg-rizzotto-iron-900 px-3 py-2 text-sm text-rizzotto-stone-100 focus:border-rizzotto-gold-500 focus:outline-none disabled:opacity-50"
          >
            <option value="">
              {isLoading ? 'Loading…' : candidates.length === 0 ? 'No eligible tournaments' : 'Select tournament…'}
            </option>
            {candidates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.status.replace(/_/g, ' ')})
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          disabled={attachMutation.isPending || !selectedId}
          onClick={() => attachMutation.mutate(selectedId)}
          className="shrink-0 rounded border border-rizzotto-iron-700 px-4 py-2 text-sm font-semibold text-rizzotto-stone-300 hover:border-rizzotto-iron-500 hover:text-rizzotto-stone-100 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
        >
          {attachMutation.isPending ? 'Attaching…' : 'Attach'}
        </button>
      </div>
      {attachError && <p className="text-xs text-red-400">{attachError}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Management panel
// ---------------------------------------------------------------------------

function ManagementPanel({ seriesSlug }: { seriesSlug: string }) {
  const queryClient = useQueryClient();
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editVisibility, setEditVisibility] = useState<'PUBLIC' | 'PRIVATE' | ''>('');

  const { data: series } = useQuery({
    queryKey: ['series', seriesSlug],
    queryFn: () => getSeries(seriesSlug),
    retry: false,
  });

  const patchMutation = useMutation({
    mutationFn: (body: { name?: string; description?: string; visibility?: 'PUBLIC' | 'PRIVATE' }) =>
      patchSeries(seriesSlug, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['series', seriesSlug] });
      setEditName('');
      setEditDesc('');
      setEditVisibility('');
    },
  });

  const pauseMutation = useMutation({
    mutationFn: (paused: boolean) => pauseSeries(seriesSlug, paused),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['series', seriesSlug] });
    },
  });

  const detachMutation = useMutation({
    mutationFn: (tournamentId: string) => detachFromSeries(seriesSlug, tournamentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['series', seriesSlug] });
    },
  });

  if (!series) return null;

  const hasEditChanges = !!(editName || editDesc || editVisibility);

  return (
    <section className="mt-10 rounded border border-rizzotto-gold-500/30 bg-rizzotto-iron-900/60 p-6">
      <h2 className="font-display text-xl font-semibold text-rizzotto-gold-500 mb-5">
        Manage Series
      </h2>

      {/* Pause / Reactivate toggle */}
      <div className="mb-6 flex items-center justify-between rounded border border-rizzotto-iron-700 bg-rizzotto-iron-900 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-rizzotto-stone-200">
            {series.paused ? 'Series is paused' : 'Series is active'}
          </p>
          <p className="text-xs text-rizzotto-stone-500 mt-0.5">
            {series.paused
              ? 'Resume the series to allow new qualifier results to update standings.'
              : 'Pause to freeze standings temporarily while you reorganise.'}
          </p>
        </div>
        <button
          type="button"
          disabled={pauseMutation.isPending}
          onClick={() => pauseMutation.mutate(!series.paused)}
          className={`shrink-0 rounded border px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            series.paused
              ? 'border-rizzotto-gold-500/60 text-rizzotto-gold-400 hover:bg-rizzotto-gold-500/10'
              : 'border-rizzotto-iron-700 text-rizzotto-stone-300 hover:border-rizzotto-iron-500 hover:text-rizzotto-stone-100'
          }`}
        >
          {pauseMutation.isPending
            ? series.paused ? 'Resuming…' : 'Pausing…'
            : series.paused ? 'Resume' : 'Pause'}
        </button>
      </div>
      {pauseMutation.isError && (
        <p className="mb-4 text-xs text-red-400">{(pauseMutation.error as Error).message}</p>
      )}

      {/* Poster upload */}
      <SeriesPosterSection seriesSlug={seriesSlug} posterUrl={series.poster_url} />

      {/* Edit name / description / visibility */}
      <div className="mb-6 space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-rizzotto-stone-400">
          Edit Details
        </h3>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-rizzotto-stone-400">Name</label>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder={series.name}
              className="w-full rounded border border-rizzotto-iron-700 bg-rizzotto-iron-900 px-3 py-2 text-sm text-rizzotto-stone-100 placeholder:text-rizzotto-stone-600 focus:border-rizzotto-gold-500 focus:outline-none"
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs text-rizzotto-stone-400">Description</label>
            <input
              type="text"
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              placeholder={series.description ?? ''}
              className="w-full rounded border border-rizzotto-iron-700 bg-rizzotto-iron-900 px-3 py-2 text-sm text-rizzotto-stone-100 placeholder:text-rizzotto-stone-600 focus:border-rizzotto-gold-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-rizzotto-stone-400">Visibility</label>
            <select
              value={editVisibility || series.visibility}
              onChange={(e) => setEditVisibility(e.target.value as 'PUBLIC' | 'PRIVATE')}
              className="rounded border border-rizzotto-iron-700 bg-rizzotto-iron-900 px-3 py-2 text-sm text-rizzotto-stone-100 focus:border-rizzotto-gold-500 focus:outline-none"
            >
              <option value="PUBLIC">Public</option>
              <option value="PRIVATE">Private</option>
            </select>
          </div>
          <button
            type="button"
            disabled={patchMutation.isPending || !hasEditChanges}
            onClick={() => {
              const body: { name?: string; description?: string; visibility?: 'PUBLIC' | 'PRIVATE' } = {};
              if (editName) body.name = editName;
              if (editDesc) body.description = editDesc;
              if (editVisibility) body.visibility = editVisibility;
              patchMutation.mutate(body);
            }}
            className="shrink-0 rounded border border-rizzotto-gold-500/60 px-4 py-2 text-sm font-semibold text-rizzotto-gold-400 hover:bg-rizzotto-gold-500/10 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          >
            {patchMutation.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
        {patchMutation.isError && (
          <p className="text-xs text-red-400">
            {(patchMutation.error as Error).message === 'Conflict'
              ? 'Could not change scoring model: a qualifier has already completed. Name, description, and visibility were saved if provided.'
              : (patchMutation.error as Error).message}
          </p>
        )}
      </div>

      {/* Attach qualifier via picker */}
      <div className="mb-6 space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-rizzotto-stone-400">
          Attach Qualifier
        </h3>
        <AttachQualifierPicker seriesSlug={seriesSlug} seriesId={series.id} />
      </div>

      {/* Current qualifiers with detach buttons */}
      {series.qualifiers.length > 0 && (
        <div className="mb-6 space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-rizzotto-stone-400">
            Attached Qualifiers
          </h3>
          <ul className="space-y-2">
            {series.qualifiers.map((q) => (
              <li
                key={q.id}
                className="flex items-center justify-between rounded border border-rizzotto-iron-700 bg-rizzotto-iron-900 px-3 py-2"
              >
                <Link
                  to="/tournaments/$slug"
                  params={{ slug: q.slug }}
                  className="text-sm text-rizzotto-gold-400 hover:text-rizzotto-gold-300 underline underline-offset-2"
                >
                  {q.name}
                </Link>
                <button
                  type="button"
                  disabled={detachMutation.isPending}
                  onClick={() => detachMutation.mutate(q.id)}
                  className="text-xs text-rizzotto-stone-500 hover:text-red-400 transition-colors disabled:opacity-40"
                >
                  Detach
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Co-host management */}
      <SeriesCoHostsSection seriesSlug={seriesSlug} />

      {/* Transfer ownership */}
      <SeriesTransferOwnerSection seriesSlug={seriesSlug} series={series} />

      {/* Lock & seed final — only shown for scoring models A/C */}
      {series.scoring_config.model !== 'NONE' && (
        <div className="border-t border-rizzotto-iron-700 pt-6 mt-6">
          <SeedFinalPanel series={series} seriesSlug={seriesSlug} />
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function SeriesDetailPage() {
  const { slug } = useParams({ from: '/series/$slug' });

  // Refetch at the same interval as TournamentDetail (15 s) so standings and
  // qualifier statuses self-update without a manual reload.
  const { data: series, isLoading, error } = useQuery({
    queryKey: ['series', slug],
    queryFn: () => getSeries(slug),
    retry: false,
    refetchInterval: 15000,
  });

  if (isLoading) {
    return (
      <PageShell variant="wide" spacing="base">
        <div className="space-y-4">
          <Skeleton className="h-10 w-1/2" />
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-64 w-full" />
        </div>
      </PageShell>
    );
  }

  if (error || !series) {
    return (
      <PageShell variant="wide" spacing="base">
        <p className="text-rizzotto-stone-400">
          {error ? (error as Error).message : 'Series not found.'}
        </p>
      </PageShell>
    );
  }

  const model = series.scoring_config.model;
  const isModelA = model === 'A';
  const isModelNone = model === 'NONE';

  // Build a map from qualifier tournament id → slug for the QualifiedList
  const qualifierSlugById = new Map(series.qualifiers.map((q) => [q.id, q.slug]));

  const modelBadgeLabel = isModelA ? 'Points race' : isModelNone ? 'Grouping only' : 'Per-qualifier';

  return (
    <PageShell variant="wide" spacing="base">
      {/* Header */}
      <div className="mb-8">
        {series.poster_url && (
          <img
            src={series.poster_url}
            alt=""
            className="mb-5 aspect-[10/3] w-full max-w-3xl rounded object-cover"
            loading="lazy"
          />
        )}
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <Badge variant={series.visibility === 'PRIVATE' ? 'default' : 'gold'}>
            {series.visibility === 'PRIVATE' ? 'Private' : 'Public'}
          </Badge>
          <Badge variant="default" className="font-mono text-xs">
            {modelBadgeLabel}
          </Badge>
          {series.paused && (
            <Badge variant="default" className="font-mono text-xs text-amber-400 border-amber-500/40 bg-amber-500/10">
              Paused
            </Badge>
          )}
        </div>
        <h1 className="font-display text-3xl font-bold text-rizzotto-gold-500">
          {series.name}
        </h1>
        {series.description && (
          <p className="mt-2 max-w-2xl text-rizzotto-stone-300">{series.description}</p>
        )}
        <p className="mt-1 text-sm text-rizzotto-stone-500">
          Organised by{' '}
          <Link
            to="/users/$id"
            params={{ id: series.owner.id }}
            className="text-rizzotto-stone-300 hover:text-rizzotto-gold-400 transition-colors"
          >
            {series.owner.username}
          </Link>
          {series.co_hosts.length > 0 && (
            <>
              {' · Co-hosted by '}
              {series.co_hosts.map((u, i) => (
                <span key={u.id}>
                  {i > 0 && ', '}
                  <Link
                    to="/users/$id"
                    params={{ id: u.id }}
                    className="text-rizzotto-stone-300 hover:text-rizzotto-gold-400 transition-colors"
                  >
                    {u.username}
                  </Link>
                </span>
              ))}
            </>
          )}
        </p>
      </div>

      {/* Standings / Qualified section — hidden for NONE model */}
      {!isModelNone && (
        <section className="mb-10">
          <h2 className="font-display text-xl font-semibold text-rizzotto-gold-500 mb-5">
            {isModelA ? 'Standings' : 'Qualified Players'}
          </h2>

          {isModelA ? (
            <StandingsTable
              standings={series.standings}
              finalSize={series.scoring_config.final_size}
              provisional={series.standings_provisional}
            />
          ) : (
            <QualifiedList
              qualified={series.qualified}
              qualifierSlugById={qualifierSlugById}
            />
          )}
        </section>
      )}

      {/* Qualifiers list + final */}
      <section className="mb-10">
        <h2 className="font-display text-xl font-semibold text-rizzotto-gold-500 mb-5">
          Qualifiers
        </h2>

        {series.qualifiers.length === 0 ? (
          <p className="text-sm text-rizzotto-stone-500">No qualifying tournaments attached yet.</p>
        ) : (
          <ul className="space-y-2">
            {series.qualifiers.map((q) => {
              const statusColors: Record<string, string> = {
                ONGOING: 'text-rizzotto-forge-400',
                COMPLETED: 'text-rizzotto-stone-500',
              };
              return (
                <li key={q.id} className="flex items-center justify-between rounded border border-rizzotto-iron-700 bg-rizzotto-iron-900/50 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-rizzotto-stone-500 w-4">
                      {q.series_position}
                    </span>
                    <Link
                      to="/tournaments/$slug"
                      params={{ slug: q.slug }}
                      className="text-rizzotto-stone-200 hover:text-rizzotto-gold-400 transition-colors"
                    >
                      {q.name}
                    </Link>
                  </div>
                  <span className={`text-xs font-mono uppercase ${statusColors[q.status] ?? 'text-rizzotto-stone-400'}`}>
                    {q.status.replace(/_/g, ' ')}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {series.final && (
          <div className="mt-5 rounded border border-rizzotto-gold-500/30 bg-rizzotto-iron-900/60 px-4 py-3 flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-rizzotto-gold-500">
                Grand Final
              </span>
              <p className="mt-0.5 text-rizzotto-stone-200">{series.final.name}</p>
            </div>
            <Link
              to="/tournaments/$slug"
              params={{ slug: series.final.slug }}
              className="text-sm text-rizzotto-gold-400 hover:text-rizzotto-gold-300 underline underline-offset-2"
            >
              View tournament
            </Link>
          </div>
        )}
      </section>

      {/* Management panel (can_manage only) */}
      {series.can_manage && <ManagementPanel seriesSlug={slug} />}
    </PageShell>
  );
}
