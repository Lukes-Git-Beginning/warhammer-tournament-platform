import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { getDraftView } from '@/lib/api';

// ---------------------------------------------------------------------------
// Minimal DraftLobby stub — M4.7 will replace this with the full component.
// ---------------------------------------------------------------------------

function DraftLobbyStub({ data }: { data: unknown }) {
  const draft = data as {
    id: string;
    status: string;
    current_turn: number;
    preset?: { name: string; turns: unknown[] };
  };
  return (
    <div className="rounded-md border border-stone-700 bg-stone-900/50 p-6 space-y-4">
      <div className="flex items-center gap-3">
        <span className="inline-block rounded px-2 py-0.5 text-xs font-medium bg-warhammer-blood text-white">
          LIVE
        </span>
        <span className="text-stone-400 text-sm">Spectator-Ansicht</span>
      </div>
      <div className="text-sm text-stone-300 space-y-1">
        <div>
          <span className="text-stone-500">Draft-ID:</span>{' '}
          <span className="font-mono text-xs">{draft.id}</span>
        </div>
        <div>
          <span className="text-stone-500">Status:</span>{' '}
          <span>{draft.status}</span>
        </div>
        <div>
          <span className="text-stone-500">Aktueller Zug:</span>{' '}
          <span>{draft.current_turn}</span>
        </div>
        {draft.preset && (
          <div>
            <span className="text-stone-500">Preset:</span>{' '}
            <span>{draft.preset.name} ({draft.preset.turns.length} Züge)</span>
          </div>
        )}
      </div>
      <details className="text-xs text-stone-500">
        <summary className="cursor-pointer hover:text-stone-400">Raw-Daten (Debug)</summary>
        <pre className="mt-2 overflow-auto rounded bg-stone-950 p-3 text-stone-400 text-xs">
          {JSON.stringify(data, null, 2)}
        </pre>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DraftSpectatorPage
// ---------------------------------------------------------------------------

export function DraftSpectatorPage() {
  const { id } = useParams({ strict: false });

  const { data, isLoading, error } = useQuery({
    queryKey: ['draft', id],
    queryFn: () => getDraftView(id!),
    enabled: !!id,
    refetchInterval: 5000, // Poll as fallback until socket integration (M4.7)
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
          Draft nicht gefunden oder nicht erreichbar.
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-warhammer-gold">
          Live-Draft — Zuschauer
        </h1>
        <p className="mt-1 text-sm text-stone-400">
          Du schaust diesem Draft zu. Picks und Bans werden ohne hidden-Informationen angezeigt.
        </p>
      </div>

      <DraftLobbyStub data={data} />
    </main>
  );
}
