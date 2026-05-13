import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { listDraftPresets, deleteDraftPreset } from '@/lib/api';
import { useAuthQuery } from '@/lib/auth';
import type { DraftPreset } from '@tww3/types';

function PresetCard({
  preset,
  canEdit,
  onDelete,
}: {
  preset: DraftPreset;
  canEdit: boolean;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-md border border-stone-800 bg-stone-900/60 p-4 flex flex-col gap-2 hover:border-stone-700 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-stone-200 truncate">{preset.name}</h3>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${
                preset.is_public
                  ? 'bg-emerald-900/60 text-emerald-300 border border-emerald-800'
                  : 'bg-stone-800 text-stone-400 border border-stone-700'
              }`}
            >
              {preset.is_public ? 'Public' : 'Privat'}
            </span>
          </div>
          {preset.description && (
            <p className="text-xs text-stone-500 mt-1 line-clamp-2">{preset.description}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 text-xs text-stone-500">
        <span>{preset.turns.length} Züge</span>
        <span>•</span>
        <span>{preset.turn_seconds}s pro Zug</span>
      </div>

      {canEdit && (
        <div className="flex gap-2 mt-1">
          <Link
            to="/presets/$id/edit"
            params={{ id: preset.id }}
            className="text-xs rounded border border-stone-700 px-2.5 py-1 text-stone-300 hover:border-stone-500 hover:text-stone-100 transition-colors"
          >
            Bearbeiten
          </Link>
          <button
            type="button"
            onClick={onDelete}
            className="text-xs text-red-600 hover:text-red-400 transition-colors"
          >
            Löschen
          </button>
        </div>
      )}
    </div>
  );
}

export function PresetListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: user } = useAuthQuery();

  const { data: presets, isLoading, error } = useQuery({
    queryKey: ['draft-presets'],
    queryFn: listDraftPresets,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteDraftPreset,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['draft-presets'] });
    },
  });

  const canCreate =
    user?.role === 'ORGANIZER' || user?.role === 'MODERATOR' || user?.role === 'ADMIN';

  function canEditPreset(preset: DraftPreset) {
    if (!user) return false;
    return preset.created_by === user.id || user.role === 'ADMIN';
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-3xl font-bold text-warhammer-gold">Draft-Presets</h1>
          <p className="text-stone-500 text-sm mt-1">
            Vordefinierte Sequenzen für den Captain&apos;s-Mode-Draft
          </p>
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={() => void navigate({ to: '/presets/new' })}
            className="rounded border border-warhammer-gold/60 bg-warhammer-gold/10 px-4 py-2 text-sm font-medium text-warhammer-gold hover:bg-warhammer-gold/20 transition-colors"
          >
            + Neuen Preset erstellen
          </button>
        )}
      </div>

      {isLoading && (
        <div className="py-8 text-center text-stone-400 text-sm">Wird geladen…</div>
      )}

      {error && (
        <div className="rounded-md border border-red-900 bg-red-950/40 p-4 text-red-300 text-sm">
          Fehler beim Laden der Presets.
        </div>
      )}

      {presets && presets.length === 0 && (
        <div className="rounded-md border border-stone-800 bg-stone-900/40 p-12 text-center">
          <p className="text-stone-400 text-sm">Noch keine Presets vorhanden.</p>
          {canCreate && (
            <button
              type="button"
              onClick={() => void navigate({ to: '/presets/new' })}
              className="mt-4 text-sm text-warhammer-gold hover:underline"
            >
              Ersten Preset erstellen →
            </button>
          )}
        </div>
      )}

      {presets && presets.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {presets.map((preset) => (
            <PresetCard
              key={preset.id}
              preset={preset}
              canEdit={canEditPreset(preset)}
              onDelete={() => {
                if (confirm(`Preset „${preset.name}" wirklich löschen?`)) {
                  deleteMutation.mutate(preset.id);
                }
              }}
            />
          ))}
        </div>
      )}
    </main>
  );
}
