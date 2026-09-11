import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { PageShell } from '@/components/layout/PageShell';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getTeam } from '@/lib/api';

const STATUS_LABEL: Record<string, string> = { ACTIVE: 'Active', FORMING: 'Forming', ARCHIVED: 'Archived' };

function initials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

export function TeamProfilePage() {
  const { id } = useParams({ from: '/teams/$id' });
  const { data: team, isLoading, isError } = useQuery({
    queryKey: ['team', id],
    queryFn: () => getTeam(id),
    retry: false,
  });

  if (isLoading) {
    return (
      <PageShell variant="narrow" className="text-rizzotto-stone-400">
        Loading…
      </PageShell>
    );
  }
  if (isError || !team) {
    return (
      <PageShell variant="narrow">
        <p className="text-rizzotto-stone-400">Team not found.</p>
        <Link to="/teams" className="mt-3 inline-block text-sm text-rizzotto-gold-400 hover:underline">
          ← All teams
        </Link>
      </PageShell>
    );
  }

  const losses = Math.max(0, team.record.matchesPlayed - team.record.matchesWon);

  return (
    <PageShell variant="narrow">
      <Link to="/teams" className="mb-4 inline-block text-sm text-rizzotto-stone-400 hover:text-rizzotto-gold-400">
        ← All teams
      </Link>

      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold text-rizzotto-gold-500">{team.name}</h1>
        <span className="rounded border border-rizzotto-iron-600 px-2 py-0.5 text-[11px] font-display uppercase tracking-wide text-rizzotto-stone-300">
          {STATUS_LABEL[team.status] ?? team.status}
        </span>
      </header>

      {/* Record */}
      <div className="mb-6 grid grid-cols-3 gap-3">
        {[
          { label: 'Matches', value: team.record.matchesPlayed },
          { label: 'Won', value: team.record.matchesWon },
          { label: 'Lost', value: losses },
        ].map((s) => (
          <Card key={s.label} variant="banner">
            <CardContent className="p-4 text-center">
              <div className="font-display text-2xl text-rizzotto-stone-100">{s.value}</div>
              <div className="text-[11px] font-display uppercase tracking-wide text-rizzotto-stone-500">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Roster */}
      <section className="mb-6">
        <h2 className="mb-3 font-display text-lg text-rizzotto-gold-400">Roster</h2>
        <div className="space-y-2">
          {team.members.map((m) => (
            <Link
              key={m.user_id}
              to="/users/$id"
              params={{ id: m.user_id }}
              className="flex items-center gap-3 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900 p-3 hover:border-rizzotto-iron-500 transition-colors"
            >
              <Avatar className="h-8 w-8">
                {m.avatar_url ? <AvatarImage src={m.avatar_url} alt={m.username} /> : <AvatarFallback>{initials(m.username)}</AvatarFallback>}
              </Avatar>
              <span className="text-sm text-rizzotto-stone-200">{m.username}</span>
              {m.is_captain && (
                <span className="text-[10px] font-display uppercase tracking-wide text-rizzotto-gold-400">Captain</span>
              )}
              {!m.accepted && (
                <span className="text-[10px] font-display uppercase tracking-wide text-rizzotto-stone-500">Pending</span>
              )}
            </Link>
          ))}
        </div>
      </section>

      {/* Tournament history */}
      <section>
        <h2 className="mb-3 font-display text-lg text-rizzotto-gold-400">Tournaments</h2>
        {team.tournaments.length === 0 ? (
          <p className="text-sm text-rizzotto-stone-500">This team hasn&apos;t entered a tournament yet.</p>
        ) : (
          <ul className="divide-y divide-rizzotto-iron-700 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900">
            {team.tournaments.map((tr) => (
              <li key={tr.slug} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <Link
                  to="/tournaments/$slug"
                  params={{ slug: tr.slug }}
                  className="text-sm text-rizzotto-stone-200 hover:text-rizzotto-gold-400 transition-colors"
                >
                  {tr.name}
                </Link>
                <span className="text-[11px] font-display uppercase tracking-wide text-rizzotto-stone-500">
                  {tr.participantStatus === 'WITHDREW' ? 'Withdrew' : tr.status.replace(/_/g, ' ').toLowerCase()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
