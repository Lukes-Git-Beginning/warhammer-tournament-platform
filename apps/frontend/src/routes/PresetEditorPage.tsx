import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { getDraftPreset, createDraftPreset, updateDraftPreset } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth';
import { PresetEditor } from '@/components/draft/PresetEditor';
import type { CreateDraftPresetRequest } from '@tww3/types';

export function PresetEditorPage() {
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
      <main className="mx-auto max-w-4xl px-4 py-10 text-stone-400 text-sm">Wird geladen…</main>
    );
  }

  if (!user) {
    return null;
  }

  const canCreate =
    user.role === 'ORGANIZER' || user.role === 'MODERATOR' || user.role === 'ADMIN';

  if (!presetId && !canCreate) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10">
        <div className="rounded-md border border-warhammer-gold/30 bg-warhammer-gold/10 p-4 text-sm text-warhammer-gold">
          Du benötigst die Organizer-Rolle, um Presets zu erstellen.
        </div>
      </main>
    );
  }

  const isEditMode = !!presetId && !!existingPreset;

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold text-warhammer-gold">
          {isEditMode ? 'Preset bearbeiten' : 'Neuen Preset erstellen'}
        </h1>
        {isEditMode && (
          <p className="text-stone-500 text-sm mt-1">{existingPreset.name}</p>
        )}
      </div>

      {(createMutation.error || updateMutation.error) && (
        <div className="mb-6 rounded-md border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">
          {(createMutation.error ?? updateMutation.error)?.message ?? 'Fehler beim Speichern'}
        </div>
      )}

      <PresetEditor
        initialPreset={isEditMode ? existingPreset : undefined}
        onSave={handleSave}
      />
    </main>
  );
}
