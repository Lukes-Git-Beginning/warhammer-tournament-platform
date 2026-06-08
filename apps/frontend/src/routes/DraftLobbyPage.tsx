import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { getDraftView } from '@/lib/api';
import { DraftLobby } from '@/components/draft/DraftLobby';

export function DraftLobbyPage() {
  const { id } = useParams({ strict: false });

  const { data, isLoading, error } = useQuery({
    queryKey: ['draft', id],
    queryFn: () => getDraftView(id!),
    enabled: !!id,
    retry: false,
  });

  if (isLoading) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10 text-stone-400">
        Lade Draft…
      </main>
    );
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

  const viewer = data.viewer_role === 'spectator' ? 'spectator' : 'player';

  return <DraftLobby draft={data} viewer={viewer} />;
}
