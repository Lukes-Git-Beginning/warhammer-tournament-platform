import { useQuery } from '@tanstack/react-query';
import { listTournaments } from '@/lib/api';
import { TournamentCard } from '@/components/tournament/TournamentCard';

export function IndexPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['tournaments', 1, 20],
    queryFn: () => listTournaments(1, 20),
    // graceful fallback if backend not yet ready
    retry: false,
  });

  return (
    <main className="mx-auto max-w-7xl px-4 py-10">
      <h1 className="font-display text-4xl font-bold text-warhammer-gold mb-2">
        TWW3 Turniere
      </h1>
      <p className="text-stone-400 mb-8">Total War: Warhammer 3 — Kompetitives Turnier-Portal</p>

      {isLoading && (
        <div className="text-stone-400 text-sm">Turniere werden geladen…</div>
      )}

      {error && (
        <div className="rounded-md border border-stone-800 bg-stone-900/50 p-6 text-stone-400 text-sm">
          Backend noch nicht erreichbar — bitte später erneut versuchen.
        </div>
      )}

      {data && data.data.length === 0 && (
        <div className="rounded-md border border-stone-800 bg-stone-900/50 p-10 text-center">
          <p className="text-stone-400">Noch keine Turniere.</p>
        </div>
      )}

      {data && data.data.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.data.map((t) => (
            <TournamentCard key={t.id} tournament={t} />
          ))}
        </div>
      )}
    </main>
  );
}
