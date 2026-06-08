import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { getDraftView } from '@/lib/api';
import { DraftLobby } from '@/components/draft/DraftLobby';

export function DraftSpectatorPage() {
  const { id } = useParams({ strict: false });

  const { data, isLoading, error } = useQuery({
    queryKey: ['draft', id],
    queryFn: () => getDraftView(id!),
    enabled: !!id,
  });

  if (isLoading) {
    return <main className="mx-auto max-w-7xl px-4 py-10 text-stone-400">Lade Draft…</main>;
  }

  if (error || !data) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10">
        <div className="rounded-md border border-red-900 bg-red-950/40 p-6 text-red-300 text-sm">
          Draft not found or not accessible.
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-4">
        <h1 className="font-display text-2xl font-bold text-rizzotto-gold-500">
          Live-Draft — Zuschauer
        </h1>
        <p className="mt-1 text-sm text-stone-400">
          Du schaust diesem Draft zu. Hidden-Picks werden erst nach Reveal sichtbar.
        </p>
      </div>

      <DraftLobby draft={data} viewer="spectator" />
    </main>
  );
}
