import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from '@tanstack/react-router';
import {
  getSeries,
  getTournament,
  listTournaments,
  patchSeries,
  attachToSeries,
  detachFromSeries,
  type StandingA,
  type QualifiedC,
} from '@/lib/api.js';
import { useAuthQuery } from '@/lib/auth.js';
import { PageShell } from '@/components/layout/PageShell.js';
import { Badge } from '@/components/ui/badge.js';
import { Skeleton } from '@/components/ui/skeleton.js';

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
// Management panel
// ---------------------------------------------------------------------------

function ManagementPanel({ seriesSlug }: { seriesSlug: string }) {
  const queryClient = useQueryClient();
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [attachInput, setAttachInput] = useState('');
  const [attachError, setAttachError] = useState<string | null>(null);

  const { data: series } = useQuery({
    queryKey: ['series', seriesSlug],
    queryFn: () => getSeries(seriesSlug),
    retry: false,
  });

  const patchMutation = useMutation({
    mutationFn: (body: { name?: string; description?: string }) =>
      patchSeries(seriesSlug, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['series', seriesSlug] });
      setEditName('');
      setEditDesc('');
    },
  });

  const attachMutation = useMutation({
    mutationFn: async (slugOrId: string) => {
      // Try to resolve: if it looks like a UUID treat as ID, otherwise fetch by slug
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      let tournamentId = slugOrId;
      if (!uuidRegex.test(slugOrId)) {
        const t = await getTournament(slugOrId);
        tournamentId = t.id;
      }
      return attachToSeries(seriesSlug, tournamentId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['series', seriesSlug] });
      setAttachInput('');
      setAttachError(null);
    },
    onError: (err: Error) => setAttachError(err.message),
  });

  const detachMutation = useMutation({
    mutationFn: (tournamentId: string) => detachFromSeries(seriesSlug, tournamentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['series', seriesSlug] });
    },
  });

  if (!series) return null;

  const readyToSeed = series.ready_to_seed;

  return (
    <section className="mt-10 rounded border border-rizzotto-gold-500/30 bg-rizzotto-iron-900/60 p-6">
      <h2 className="font-display text-xl font-semibold text-rizzotto-gold-500 mb-5">
        Manage Series
      </h2>

      {/* Edit name / description */}
      <div className="mb-6 space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-rizzotto-stone-400">
          Edit Details
        </h3>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
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
          <button
            type="button"
            disabled={patchMutation.isPending || (!editName && !editDesc)}
            onClick={() => {
              const body: { name?: string; description?: string } = {};
              if (editName) body.name = editName;
              if (editDesc) body.description = editDesc;
              patchMutation.mutate(body);
            }}
            className="shrink-0 rounded border border-rizzotto-gold-500/60 px-4 py-2 text-sm font-semibold text-rizzotto-gold-400 hover:bg-rizzotto-gold-500/10 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          >
            {patchMutation.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
        {patchMutation.isError && (
          <p className="text-xs text-red-400">{(patchMutation.error as Error).message}</p>
        )}
      </div>

      {/* Attach tournament */}
      <div className="mb-6 space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-rizzotto-stone-400">
          Attach Qualifier
        </h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={attachInput}
            onChange={(e) => setAttachInput(e.target.value)}
            placeholder="Tournament slug or ID"
            className="flex-1 rounded border border-rizzotto-iron-700 bg-rizzotto-iron-900 px-3 py-2 text-sm text-rizzotto-stone-100 placeholder:text-rizzotto-stone-600 focus:border-rizzotto-gold-500 focus:outline-none"
          />
          <button
            type="button"
            disabled={attachMutation.isPending || !attachInput.trim()}
            onClick={() => attachMutation.mutate(attachInput.trim())}
            className="shrink-0 rounded border border-rizzotto-iron-700 px-4 py-2 text-sm font-semibold text-rizzotto-stone-300 hover:border-rizzotto-iron-500 hover:text-rizzotto-stone-100 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          >
            {attachMutation.isPending ? 'Attaching…' : 'Attach'}
          </button>
        </div>
        {attachError && <p className="text-xs text-red-400">{attachError}</p>}
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

      {/* Lock & seed final */}
      <div>
        <button
          type="button"
          disabled
          title={
            readyToSeed
              ? 'Seeding endpoint coming soon — all qualifiers are complete.'
              : 'Not all qualifiers are complete yet.'
          }
          className="rounded border border-rizzotto-iron-700 px-4 py-2 text-sm font-semibold text-rizzotto-stone-600 cursor-not-allowed opacity-50"
        >
          Lock &amp; Seed Final
          {readyToSeed && (
            <span className="ml-2 text-xs text-rizzotto-gold-600">(coming soon)</span>
          )}
        </button>
        <p className="mt-1 text-xs text-rizzotto-stone-600">
          {readyToSeed
            ? 'All qualifiers are complete. Seeding will be available in a future update.'
            : 'Available once all qualifying tournaments are completed.'}
        </p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function SeriesDetailPage() {
  const { slug } = useParams({ from: '/series/$slug' });
  const { data: me } = useAuthQuery();

  const { data: series, isLoading, error } = useQuery({
    queryKey: ['series', slug],
    queryFn: () => getSeries(slug),
    retry: false,
  });

  // Prefetch tournament list for the attach dropdown (small, best-effort)
  useQuery({
    queryKey: ['tournaments', 1, 50],
    queryFn: () => listTournaments(1, 50),
    retry: false,
    enabled: !!me && !!series?.can_manage,
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

  const isModelA = series.scoring_config.model === 'A';

  // Build a map from qualifier tournament id → slug for the QualifiedList
  const qualifierSlugById = new Map(series.qualifiers.map((q) => [q.id, q.slug]));

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
            {isModelA ? 'Points race' : 'Per-qualifier'}
          </Badge>
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
        </p>
      </div>

      {/* Standings / Qualified section */}
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
