import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { getDraftPreset, createDraftPreset, updateDraftPreset } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth';
import { PresetEditor } from '@/components/draft/PresetEditor';
import { PageShell } from '@/components/layout/PageShell';
import type { CreateDraftPresetRequest } from '@rizzotto/types';

export function PresetEditorPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: user, isLoading: authLoading } = useRequireAuth();

  // Try to get the $id param — undefined on /presets/new route
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params = useParams({ strict: false }) as Record<string, any>;
  const presetId = (params['id'] as string | undefined) ?? null;

  const { data: existingPreset, isLoading: presetLoading } = useQuery({
    queryKey: ['draft-preset', presetId],
    queryFn: () => getDraftPreset(presetId!),
    enabled: !!presetId,
  });

  const createMutation = useMutation({
    mutationFn: createDraftPreset,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['draft-presets'] });
      void navigate({ to: '/presets' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (input: CreateDraftPresetRequest) => updateDraftPreset(presetId!, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['draft-presets'] });
      void queryClient.invalidateQueries({ queryKey: ['draft-preset', presetId] });
      void navigate({ to: '/presets' });
    },
  });

  async function handleSave(input: CreateDraftPresetRequest) {
    if (presetId) {
      await updateMutation.mutateAsync(input);
    } else {
      await createMutation.mutateAsync(input);
    }
  }

  if (authLoading || (presetId && presetLoading)) {
    return (
      <PageShell variant="narrow" className="text-rizzotto-stone-400 text-sm">
        {t('common.loading')}
      </PageShell>
    );
  }

  if (!user) {
    return null;
  }

  const canCreate =
    user.role === 'ORGANIZER' || user.role === 'MODERATOR' || user.role === 'ADMIN';

  if (!presetId && !canCreate) {
    return (
      <PageShell variant="narrow">
        <div className="rounded-md border border-rizzotto-gold-500/30 bg-rizzotto-gold-500/10 p-4 text-sm text-rizzotto-gold-500">
          {t('preset.editor.permission_denied')}
        </div>
      </PageShell>
    );
  }

  const isEditMode = !!presetId && !!existingPreset;

  return (
    <PageShell variant="narrow">
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold text-rizzotto-gold-500">
          {isEditMode ? t('preset.editor.edit_title') : t('preset.editor.create_title')}
        </h1>
        {isEditMode && (
          <p className="text-rizzotto-stone-500 text-sm mt-1">{existingPreset.name}</p>
        )}
      </div>

      {(createMutation.error || updateMutation.error) && (
        <div className="mb-6 rounded-md border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">
          {(createMutation.error ?? updateMutation.error)?.message ?? t('preset.editor.save_error')}
        </div>
      )}

      <PresetEditor
        initialPreset={isEditMode ? existingPreset : undefined}
        onSave={handleSave}
      />
    </PageShell>
  );
}
