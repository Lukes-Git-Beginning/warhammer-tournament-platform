import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from '@tanstack/react-router';
import { apiFetch } from '@/lib/api.js';
import type { H2HResponse } from '@rizzotto/types';
import { PageShell } from '@/components/layout/PageShell.js';
import { EmptyState } from '@/components/ui/empty-state.js';
import { Skeleton } from '@/components/ui/skeleton.js';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar.js';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PlayerCard({
  player,
}: {
  player: H2HResponse['player_a'];
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <Avatar className="h-16 w-16">
        <AvatarImage src={player.avatar_url ?? undefined} alt={player.username} />
        <AvatarFallback className="bg-stone-700 text-stone-200 text-xl font-bold">
          {player.username[0]?.toUpperCase() ?? '?'}
        </AvatarFallback>
      </Avatar>
      <Link
        to="/users/$id"
        params={{ id: player.id }}
        className="font-display text-lg font-semibold text-rizzotto-gold-400 hover:text-rizzotto-gold-300 transition-colors"
      >
        {player.username}
      </Link>
    </div>
  );
}

function SummaryBlock({ data }: { data: H2HResponse }) {
  const { summary, winrate_a, player_a, player_b } = data;
  return (
    <div className="rounded-md border border-stone-800 bg-stone-900/60 p-6">
      {/* Score row */}
      <div className="flex items-center justify-center gap-6 mb-4">
        <div className="text-center">
          <div className="text-4xl font-bold text-emerald-400">{summary.a_wins}</div>
          <div className="text-xs text-stone-500 mt-1">{player_a.username}</div>
        </div>
        <div className="text-center">
          <div className="text-3xl font-semibold text-stone-500">{summary.draws}</div>
          <div className="text-xs text-stone-600 mt-1">Draws</div>
        </div>
        <div className="text-center">
          <div className="text-4xl font-bold text-red-400">{summary.b_wins}</div>
          <div className="text-xs text-stone-500 mt-1">{player_b.username}</div>
        </div>
      </div>
      {/* Meta row */}
      <div className="flex items-center justify-center gap-6 text-sm text-stone-400 border-t border-stone-800 pt-4">
        <span>
          <span className="font-semibold text-stone-200">{summary.total}</span> games
        </span>
        <span>
          Win-Rate {player_a.username}:{' '}
          <span className="font-semibold text-rizzotto-gold-400">
            {Math.round(winrate_a * 100)}%
          </span>
        </span>
      </div>
    </div>
  );
}

function FactionBreakdown({ data }: { data: H2HResponse }) {
  const { faction_breakdown, player_a, player_b } = data;

  if (faction_breakdown.length === 0) {
    return (
      <p className="text-sm text-stone-500 italic">Keine Fraktionsdaten vorhanden.</p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-stone-800">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-stone-800 bg-stone-900/60">
            <th className="px-4 py-3 text-left font-medium text-stone-400">Fraktion</th>
            <th className="px-4 py-3 text-center font-medium text-stone-400">
              {player_a.username}
            </th>
            <th className="px-4 py-3 text-center font-medium text-stone-400">Draws</th>
            <th className="px-4 py-3 text-center font-medium text-stone-400">
              {player_b.username}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-800/60">
          {faction_breakdown.map((row) => (
            <tr key={row.faction_id} className="hover:bg-stone-800/30 transition-colors">
              <td className="px-4 py-3 text-stone-200">{row.faction_name}</td>
              <td className="px-4 py-3 text-center text-emerald-400 font-semibold">
                {row.a_wins}
              </td>
              <td className="px-4 py-3 text-center text-stone-500">{row.draws}</td>
              <td className="px-4 py-3 text-center text-red-400 font-semibold">{row.b_wins}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecentMatchesList({ data }: { data: H2HResponse }) {
  const { recent_matches, player_a, player_b } = data;

  if (recent_matches.length === 0) {
    return (
      <p className="text-sm text-stone-500 italic">No recent duels found.</p>
    );
  }

  return (
    <div className="space-y-2">
      {recent_matches.map((m) => {
        const dateStr = m.played_at
          ? new Date(m.played_at).toLocaleDateString('en-GB', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
            })
          : '—';

        const resultLabel =
          m.result === 'PLAYER1_WIN'
            ? `${player_a.username} wins`
            : m.result === 'PLAYER2_WIN'
              ? `${player_b.username} wins`
              : m.result === 'DRAW'
                ? 'Draw'
                : '—';

        const resultColor =
          m.result === 'PLAYER1_WIN'
            ? 'text-emerald-400'
            : m.result === 'PLAYER2_WIN'
              ? 'text-red-400'
              : 'text-stone-500';

        return (
          <div
            key={m.id}
            className="flex items-center justify-between rounded-md border border-stone-800 bg-stone-900/40 px-4 py-3 text-sm"
          >
            <div className="flex items-center gap-3">
              {m.tournament_slug ? (
                <Link
                  to="/tournaments/$slug"
                  params={{ slug: m.tournament_slug }}
                  className="text-stone-300 hover:text-rizzotto-gold-400 transition-colors"
                >
                  {m.player_a_faction?.name ?? '?'} vs {m.player_b_faction?.name ?? '?'}
                </Link>
              ) : (
                <span className="text-stone-400">
                  {m.player_a_faction?.name ?? '?'} vs {m.player_b_faction?.name ?? '?'}
                </span>
              )}
            </div>
            <div className="flex items-center gap-4">
              <span className={`font-medium ${resultColor}`}>{resultLabel}</span>
              <span className="text-stone-600 text-xs">{dateStr}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function H2HPage() {
  const { a, b } = useParams({ from: '/users/$a/vs/$b' });

  const { data, isLoading, error } = useQuery({
    queryKey: ['h2h', a, b],
    queryFn: () => apiFetch<H2HResponse>(`/api/users/${a}/vs/${b}`),
    retry: false,
  });

  if (isLoading) {
    return (
      <PageShell variant="wide" className="space-y-8">
        <div className="flex items-center justify-center gap-12">
          <Skeleton className="h-16 w-16 rounded-full" />
          <Skeleton className="h-8 w-12" />
          <Skeleton className="h-16 w-16 rounded-full" />
        </div>
        <Skeleton className="h-40 w-full rounded-md" />
        <Skeleton className="h-32 w-full rounded-md" />
      </PageShell>
    );
  }

  if (error) {
    // ApiError has .status — narrow to 404 for "not found"
    const status = (error as { status?: number }).status;
    if (status === 404) {
      return (
        <PageShell variant="wide">
          <EmptyState
            variant="sigil"
            title="Player not found"
            body="One or both players do not exist."
          />
        </PageShell>
      );
    }
    return (
      <PageShell variant="wide">
        <EmptyState
          variant="compact"
          title="Failed to load"
          body="Could not load head-to-head data."
        />
      </PageShell>
    );
  }

  if (!data) {
    return null;
  }

  if (data.summary.total === 0) {
    return (
      <PageShell variant="wide" className="space-y-8">
        {/* Header even when no matches */}
        <div className="flex items-center justify-center gap-8">
          <PlayerCard player={data.player_a} />
          <span className="font-display text-2xl font-bold text-stone-500">VS</span>
          <PlayerCard player={data.player_b} />
        </div>
        <EmptyState
          variant="sigil"
          title="No head-to-head yet"
          body="These two players have not faced each other yet."
        />
      </PageShell>
    );
  }

  return (
    <PageShell variant="wide" className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-center gap-8">
        <PlayerCard player={data.player_a} />
        <span className="font-display text-2xl font-bold text-stone-500">VS</span>
        <PlayerCard player={data.player_b} />
      </div>

      {/* Summary */}
      <section>
        <h2 className="font-display text-lg font-semibold text-rizzotto-gold-500 mb-3">
          Overview
        </h2>
        <SummaryBlock data={data} />
      </section>

      {/* Faction Breakdown */}
      <section>
        <h2 className="font-display text-lg font-semibold text-rizzotto-gold-500 mb-3">
          Faction Breakdown
        </h2>
        <FactionBreakdown data={data} />
      </section>

      {/* Recent Matches */}
      <section>
        <h2 className="font-display text-lg font-semibold text-rizzotto-gold-500 mb-3">
          Recent Duels
        </h2>
        <RecentMatchesList data={data} />
      </section>
    </PageShell>
  );
}
