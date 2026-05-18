import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listDraftPresets, promotePreset } from '@/lib/api';
import type { DraftPreset } from '@rizzotto/types';

export function PresetLibraryAdmin() {
  const queryClient = useQueryClient();

  const { data: presets = [], isLoading, error } = useQuery<DraftPreset[]>({
    queryKey: ['draft-presets'],
    queryFn: listDraftPresets,
  });

  const promoteMutation = useMutation({
    mutationFn: (id: string) => promotePreset(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['draft-presets'] });
    },
  });

  if (isLoading) {
    return <div className="py-8 text-center text-stone-400 text-sm">Wird geladen…</div>;
  }

  if (error) {
    return (
      <div className="rounded-md border border-red-900 bg-red-950/40 p-4 text-red-300 text-sm">
        Fehler beim Laden der Presets.
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto rounded-md border border-stone-800">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-stone-800 bg-stone-900/60">
              <th className="px-4 py-3 text-left font-medium text-stone-400">Name</th>
              <th className="px-4 py-3 text-left font-medium text-stone-400">Erstellt von</th>
              <th className="px-4 py-3 text-left font-medium text-stone-400">Status</th>
              <th className="px-4 py-3 text-left font-medium text-stone-400">Aktion</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-800/60">
            {presets.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-stone-500">
                  Keine Presets vorhanden.
                </td>
              </tr>
            )}
            {presets.map((preset) => (
              <tr key={preset.id} className="hover:bg-stone-800/30 transition-colors">
                <td className="px-4 py-3 text-stone-200 font-medium">{preset.name}</td>
                <td className="px-4 py-3 font-mono text-xs text-stone-400">
                  {preset.created_by.slice(0, 12)}…
                </td>
                <td className="px-4 py-3">
                  {preset.is_public ? (
                    <span className="rounded bg-emerald-900/40 px-2 py-0.5 text-xs font-medium text-emerald-300">
                      Öffentlich
                    </span>
                  ) : (
                    <span className="rounded bg-stone-800 px-2 py-0.5 text-xs font-medium text-stone-400">
                      Privat
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {!preset.is_public && (
                    <button
                      type="button"
                      onClick={() => promoteMutation.mutate(preset.id)}
                      disabled={promoteMutation.isPending && promoteMutation.variables === preset.id}
                      className="rounded border border-warhammer-gold/60 px-3 py-1 text-xs font-semibold text-warhammer-gold hover:bg-warhammer-gold/10 disabled:opacity-40 transition-colors"
                    >
                      Promote
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {promoteMutation.error && (
        <p className="mt-3 text-sm text-red-400">
          Fehler beim Promoten: {(promoteMutation.error as Error).message}
        </p>
      )}
    </div>
  );
}
