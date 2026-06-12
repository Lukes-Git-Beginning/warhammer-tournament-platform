import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { listDraftPresets, deleteDraftPreset } from '@/lib/api';
import { useAuthQuery } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import type { DraftPreset } from '@rizzotto/types';

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
              {preset.is_public ? 'Public' : 'Private'}
            </span>
          </div>
          {preset.description && (
            <p className="text-xs text-stone-500 mt-1 line-clamp-2">{preset.description}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 text-xs text-stone-500">
        <span>{preset.turns.length} moves</span>
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
            Edit
          </Link>
          <button
            type="button"
            onClick={onDelete}
            className="text-xs text-red-600 hover:text-red-400 transition-colors"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

export function PresetListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: user } = useAuthQuery();

  const {
    data: presets,
    isLoading,
    error,
  } = useQuery({
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
    user?.role === 'HOST' || user?.role === 'MODERATOR' || user?.role === 'ADMIN';

  function canEditPreset(preset: DraftPreset) {
    if (!user) return false;
    return preset.created_by === user.id || user.role === 'ADMIN';
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-3xl font-bold text-rizzotto-gold-500">
            {t('preset.list_title')}
          </h1>
        </div>
        {canCreate && (
          <Button variant="iron" size="sm" onClick={() => void navigate({ to: '/presets/new' })}>
            {t('preset.create_button')}
          </Button>
        )}
      </div>

      {isLoading && (
        <div className="py-8 text-center text-stone-400 text-sm">{t('preset.loading')}</div>
      )}

      {error && (
        <div className="rounded-md border border-red-900 bg-red-950/40 p-4 text-red-300 text-sm">
          {t('preset.load_error')}
        </div>
      )}

      {presets && presets.length === 0 && (
        <EmptyState
          variant="sigil"
          title={t('preset.empty_title')}
          body={t('preset.empty_body')}
          motto={t('preset.empty_motto')}
          mottoTitle={t('preset.empty_motto_title')}
          cta={
            canCreate ? (
              <Button
                variant="forge"
                size="md"
                onClick={() => void navigate({ to: '/presets/new' })}
              >
                {t('preset.empty_cta_first')}
              </Button>
            ) : undefined
          }
        />
      )}

      {presets && presets.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {presets.map((preset) => (
            <PresetCard
              key={preset.id}
              preset={preset}
              canEdit={canEditPreset(preset)}
              onDelete={() => {
                if (confirm(t('preset.delete_confirm', { name: preset.name }))) {
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
