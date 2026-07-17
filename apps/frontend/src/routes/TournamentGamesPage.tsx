import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from '@tanstack/react-router';
import { getTournamentGames, getTournament } from '@/lib/api';
import { PageShell } from '@/components/layout/PageShell';
import { GameHistoryTable } from '@/components/match/GameHistoryTable';

export function TournamentGamesPage() {
  const { slug } = useParams({ from: '/tournaments/$slug/games' });

  const { data: tournament } = useQuery({
    queryKey: ['tournament', slug],
    queryFn: () => getTournament(slug),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['tournament-games', slug],
    queryFn: () => getTournamentGames(slug),
    enabled: !!slug,
  });

  return (
    <PageShell variant="wide">
      <div className="mb-6 flex items-center gap-3">
        <Link
          to="/tournaments/$slug"
          params={{ slug }}
          className="text-stone-500 hover:text-stone-300 text-sm transition-colors"
        >
          ← {tournament?.name ?? slug}
        </Link>
      </div>

      <h1 className="font-display text-2xl font-bold text-rizzotto-gold-500 mb-6">
        Game History
      </h1>

      {isLoading && (
        <div className="flex justify-center py-8">
          <span className="h-6 w-6 rounded-full border-2 border-rizzotto-gold-400 border-t-transparent animate-spin" />
        </div>
      )}

      {data && <GameHistoryTable games={data.games} />}
    </PageShell>
  );
}
