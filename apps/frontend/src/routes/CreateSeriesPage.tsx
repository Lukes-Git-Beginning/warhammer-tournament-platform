import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { createSeries, listTournaments, type ScoringConfig } from '@/lib/api.js';
import { useRequireAuth } from '@/lib/auth.js';
import { PageShell } from '@/components/layout/PageShell.js';

type SeriesModel = 'A' | 'C' | 'NONE';

const DEFAULT_TIEBREAKERS: ScoringConfig['tiebreakers'] = ['points', 'wins', 'games', 'random'];

export function CreateSeriesPage() {
  const navigate = useNavigate();
  useRequireAuth();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [model, setModel] = useState<SeriesModel>('A');
  const [visibility, setVisibility] = useState<'PUBLIC' | 'PRIVATE'>('PUBLIC');

  // Model A fields
  const [pointsPerGamePlayed, setPointsPerGamePlayed] = useState(1);
  const [pointsPerWin, setPointsPerWin] = useState(1);
  const [finalSize, setFinalSize] = useState(16);

  // Model C fields
  const [topX, setTopX] = useState(2);

  // Qualifier multi-select
  const [selectedQualifierIds, setSelectedQualifierIds] = useState<Set<string>>(new Set());

  const { data: tournamentsData } = useQuery({
    queryKey: ['tournaments', 1, 50],
    queryFn: () => listTournaments(1, 50),
    retry: false,
  });

  const tournaments = tournamentsData?.data ?? [];

  const createMutation = useMutation({
    mutationFn: createSeries,
    onSuccess: (data) => {
      void navigate({ to: '/series/$slug', params: { slug: data.slug } });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const scoringConfig: ScoringConfig =
      model === 'A'
        ? {
            model: 'A',
            points_per_game_played: pointsPerGamePlayed,
            points_per_win: pointsPerWin,
            final_size: finalSize,
            top_x: 2,
            tiebreakers: DEFAULT_TIEBREAKERS,
          }
        : model === 'C'
          ? {
              model: 'C',
              points_per_game_played: 1,
              points_per_win: 1,
              final_size: 16,
              top_x: topX,
              tiebreakers: DEFAULT_TIEBREAKERS,
            }
          : {
              model: 'NONE',
              points_per_game_played: 1,
              points_per_win: 1,
              final_size: 16,
              top_x: 2,
              tiebreakers: DEFAULT_TIEBREAKERS,
            };

    createMutation.mutate({
      name: name.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      visibility,
      scoring_config: scoringConfig,
      ...(selectedQualifierIds.size > 0
        ? { qualifier_ids: Array.from(selectedQualifierIds) }
        : {}),
    });
  };

  const toggleQualifier = (id: string) => {
    setSelectedQualifierIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const inputClass =
    'w-full rounded border border-rizzotto-iron-700 bg-rizzotto-iron-900 px-3 py-2 text-sm text-rizzotto-stone-100 placeholder:text-rizzotto-stone-600 focus:border-rizzotto-gold-500 focus:outline-none';
  const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wider text-rizzotto-stone-400';
  const numberInputClass = `${inputClass} w-28`;

  return (
    <PageShell variant="narrow" spacing="base">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold text-rizzotto-gold-500">
          Create Tournament Series
        </h1>
        <p className="mt-2 text-sm text-rizzotto-stone-400">
          Set up a multi-event series tracking standings across qualifier tournaments.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Basic info */}
        <section className="space-y-5">
          <div>
            <label className={labelClass}>Series Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Season 3 Championship"
              required
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description shown on the series page."
              rows={3}
              className={`${inputClass} resize-y`}
            />
          </div>

          <div>
            <label className={labelClass}>Visibility</label>
            <div className="flex gap-3">
              {(['PUBLIC', 'PRIVATE'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setVisibility(v)}
                  aria-pressed={visibility === v}
                  className={`rounded border px-4 py-2 text-sm font-medium transition-colors ${
                    visibility === v
                      ? 'border-rizzotto-gold-400/70 bg-rizzotto-gold-500/20 text-rizzotto-gold-300'
                      : 'border-rizzotto-iron-700 text-rizzotto-stone-400 hover:border-rizzotto-iron-500 hover:text-rizzotto-stone-200'
                  }`}
                >
                  {v === 'PUBLIC' ? 'Public' : 'Private'}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Scoring model */}
        <section className="space-y-5">
          <h2 className="font-display text-lg font-semibold text-rizzotto-gold-500">
            Scoring Model
          </h2>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setModel('A')}
              aria-pressed={model === 'A'}
              className={`rounded border px-4 py-2 text-sm font-medium transition-colors ${
                model === 'A'
                  ? 'border-rizzotto-gold-400/70 bg-rizzotto-gold-500/20 text-rizzotto-gold-300'
                  : 'border-rizzotto-iron-700 text-rizzotto-stone-400 hover:border-rizzotto-iron-500 hover:text-rizzotto-stone-200'
              }`}
            >
              Points Race (A)
            </button>
            <button
              type="button"
              onClick={() => setModel('C')}
              aria-pressed={model === 'C'}
              className={`rounded border px-4 py-2 text-sm font-medium transition-colors ${
                model === 'C'
                  ? 'border-rizzotto-gold-400/70 bg-rizzotto-gold-500/20 text-rizzotto-gold-300'
                  : 'border-rizzotto-iron-700 text-rizzotto-stone-400 hover:border-rizzotto-iron-500 hover:text-rizzotto-stone-200'
              }`}
            >
              Per-Qualifier (C)
            </button>
            <button
              type="button"
              onClick={() => setModel('NONE')}
              aria-pressed={model === 'NONE'}
              className={`rounded border px-4 py-2 text-sm font-medium transition-colors ${
                model === 'NONE'
                  ? 'border-rizzotto-gold-400/70 bg-rizzotto-gold-500/20 text-rizzotto-gold-300'
                  : 'border-rizzotto-iron-700 text-rizzotto-stone-400 hover:border-rizzotto-iron-500 hover:text-rizzotto-stone-200'
              }`}
            >
              None — just group tournaments (weekly format)
            </button>
          </div>

          {model === 'NONE' && (
            <p className="text-xs text-rizzotto-stone-500">
              No scoring or qualification tracking — the series acts as a grouping / schedule for related tournaments. A final is optional.
            </p>
          )}

          {model === 'A' && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className={labelClass}>Points per Game Played</label>
                <input
                  type="number"
                  min={0}
                  value={pointsPerGamePlayed}
                  onChange={(e) => setPointsPerGamePlayed(Number(e.target.value))}
                  className={numberInputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Points per Win</label>
                <input
                  type="number"
                  min={0}
                  value={pointsPerWin}
                  onChange={(e) => setPointsPerWin(Number(e.target.value))}
                  className={numberInputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Final Size</label>
                <input
                  type="number"
                  min={2}
                  value={finalSize}
                  onChange={(e) => setFinalSize(Number(e.target.value))}
                  className={numberInputClass}
                />
                <p className="mt-1 text-xs text-rizzotto-stone-500">
                  Top N players qualify for the final.
                </p>
              </div>
            </div>
          )}

          {model === 'C' && (
            <div>
              <label className={labelClass}>Top X per Qualifier</label>
              <select
                value={topX}
                onChange={(e) => setTopX(Number(e.target.value))}
                className={numberInputClass}
              >
                <option value={1}>Top 1 (winner)</option>
                <option value={2}>Top 2 (finalists)</option>
                <option value={3}>Top 3</option>
                <option value={4}>Top 4</option>
              </select>
              <p className="mt-1 text-xs text-rizzotto-stone-500">
                The top X of each qualifier's highest-division playoff qualify. Top 3 or 4 requires a
                third-place match in the qualifier (5th+ isn't cleanly rankable).
              </p>
            </div>
          )}
        </section>

        {/* Attach qualifying tournaments */}
        {tournaments.length > 0 && (
          <section className="space-y-3">
            <h2 className="font-display text-lg font-semibold text-rizzotto-gold-500">
              Attach Qualifying Tournaments
            </h2>
            <p className="text-sm text-rizzotto-stone-400">
              Optionally add existing tournaments as qualifiers now.
            </p>
            <div className="max-h-56 overflow-y-auto rounded border border-rizzotto-iron-700 bg-rizzotto-iron-900 divide-y divide-rizzotto-iron-800">
              {tournaments.map((t) => (
                <label
                  key={t.id}
                  className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-rizzotto-iron-800 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={selectedQualifierIds.has(t.id)}
                    onChange={() => toggleQualifier(t.id)}
                    className="accent-rizzotto-gold-500"
                  />
                  <span className="text-sm text-rizzotto-stone-200">{t.name}</span>
                  <span className="ml-auto text-xs text-rizzotto-stone-500 font-mono">
                    {t.status.replace(/_/g, ' ')}
                  </span>
                </label>
              ))}
            </div>
            {selectedQualifierIds.size > 0 && (
              <p className="text-xs text-rizzotto-stone-500">
                {selectedQualifierIds.size} tournament{selectedQualifierIds.size !== 1 ? 's' : ''} selected
              </p>
            )}
          </section>
        )}

        {/* Submit */}
        {createMutation.isError && (
          <p className="text-sm text-red-400">
            {(createMutation.error as Error).message}
          </p>
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={createMutation.isPending || !name.trim()}
            className="rounded border border-rizzotto-gold-500/60 px-6 py-2.5 text-sm font-semibold text-rizzotto-gold-400 hover:bg-rizzotto-gold-500/10 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          >
            {createMutation.isPending ? 'Creating…' : 'Create Series'}
          </button>
          <button
            type="button"
            onClick={() => void navigate({ to: '/series' })}
            className="rounded border border-rizzotto-iron-700 px-6 py-2.5 text-sm text-rizzotto-stone-400 hover:border-rizzotto-iron-500 hover:text-rizzotto-stone-200 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </PageShell>
  );
}
