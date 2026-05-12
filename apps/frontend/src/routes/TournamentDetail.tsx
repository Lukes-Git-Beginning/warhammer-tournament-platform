import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import ReactMarkdown from 'react-markdown';
import DOMPurify from 'dompurify';
import { getTournament } from '@/lib/api';
import { useAuthQuery } from '@/lib/auth';
import { BracketView } from '@/components/bracket/BracketView';

const FORMAT_LABELS: Record<string, string> = {
  SINGLE_ELIMINATION: 'Single Elimination',
  SWISS: 'Swiss',
  ROUND_ROBIN: 'Round Robin',
  DOUBLE_ELIMINATION: 'Double Elimination',
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-stone-700 text-stone-300',
  OPEN_REGISTRATION: 'bg-emerald-800 text-emerald-200',
  REGISTRATION_CLOSED: 'bg-yellow-900 text-yellow-200',
  ONGOING: 'bg-warhammer-blood text-white',
  COMPLETED: 'bg-stone-600 text-stone-300',
};

// Sanitize markdown HTML output via DOMPurify
function SafeMarkdown({ children }: { children: string }) {
  const clean = DOMPurify.sanitize(children);
  return (
    <ReactMarkdown
      components={{
        // Override to use sanitized content
        p: ({ children: c }) => <p className="mb-3">{c}</p>,
        h2: ({ children: c }) => (
          <h2 className="font-display text-xl font-semibold mt-5 mb-2 text-warhammer-gold">{c}</h2>
        ),
        ul: ({ children: c }) => <ul className="list-disc pl-5 mb-3 space-y-1">{c}</ul>,
        ol: ({ children: c }) => <ol className="list-decimal pl-5 mb-3 space-y-1">{c}</ol>,
        code: ({ children: c }) => (
          <code className="rounded bg-stone-800 px-1 py-0.5 text-sm font-mono">{c}</code>
        ),
      }}
    >
      {clean}
    </ReactMarkdown>
  );
}

export function TournamentDetail() {
  const { slug } = useParams({ from: '/tournaments/$slug' });
  const { data: user } = useAuthQuery();

  const { data: tournament, isLoading, error } = useQuery({
    queryKey: ['tournament', slug],
    queryFn: () => getTournament(slug),
    retry: false,
  });

  if (isLoading) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10 text-stone-400">Wird geladen…</main>
    );
  }

  if (error || !tournament) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10">
        <div className="rounded-md border border-red-900 bg-red-950/40 p-6 text-red-300 text-sm">
          Turnier nicht gefunden oder nicht erreichbar.
        </div>
      </main>
    );
  }

  const statusColor = STATUS_COLORS[tournament.status] ?? 'bg-stone-700 text-stone-300';
  const formatLabel = FORMAT_LABELS[tournament.format] ?? tournament.format;
  const startDate = new Date(tournament.start_date).toLocaleString('de-DE', {
    dateStyle: 'full',
    timeStyle: 'short',
  });

  const canManage =
    user &&
    (user.role === 'MODERATOR' || user.role === 'ADMIN' ||
      (user.role === 'ORGANIZER' && tournament.organizer?.id === user.id));

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <div className="flex flex-wrap items-start gap-3 mb-6">
        <h1 className="font-display text-3xl font-bold text-warhammer-gold flex-1">
          {tournament.name}
        </h1>
        <div className="flex gap-2">
          <span className="rounded px-2 py-1 text-xs font-medium bg-stone-700 text-stone-200">
            {formatLabel}
          </span>
          <span className={`rounded px-2 py-1 text-xs font-medium ${statusColor}`}>
            {tournament.status}
          </span>
        </div>
      </div>

      {canManage && (
        <div className="flex gap-3 mb-6">
          <button
            type="button"
            className="rounded border border-stone-700 px-4 py-1.5 text-sm text-stone-300 hover:border-warhammer-gold hover:text-warhammer-gold transition-colors"
            onClick={() => {
              // Stub: Edit — M2+
            }}
          >
            Bearbeiten
          </button>
          <button
            type="button"
            className="rounded border border-red-900 px-4 py-1.5 text-sm text-red-400 hover:border-red-600 hover:text-red-300 transition-colors"
            onClick={() => {
              // Stub: Delete — M2+
            }}
          >
            Löschen
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 mb-8">
        <div className="space-y-2 text-sm">
          <div>
            <span className="text-stone-500">Start:</span>{' '}
            <span className="text-stone-200">{startDate}</span>
          </div>
          <div>
            <span className="text-stone-500">Zeitzone:</span>{' '}
            <span className="text-stone-200">{tournament.timezone}</span>
          </div>
          {tournament.max_participants && (
            <div>
              <span className="text-stone-500">Max. Teilnehmer:</span>{' '}
              <span className="text-stone-200">{tournament.max_participants}</span>
            </div>
          )}
          {tournament.participantCount !== undefined && (
            <div>
              <span className="text-stone-500">Angemeldet:</span>{' '}
              <span className="text-stone-200">{tournament.participantCount}</span>
            </div>
          )}
          {tournament.organizer && (
            <div>
              <span className="text-stone-500">Organisator:</span>{' '}
              <span className="text-stone-200">{tournament.organizer.username}</span>
            </div>
          )}
          {tournament.discord_link && (
            <div>
              <a
                href={tournament.discord_link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#5865F2] hover:underline"
              >
                Discord-Server
              </a>
            </div>
          )}
        </div>
      </div>

      {tournament.description && (
        <section className="mb-8">
          <h2 className="font-display text-xl font-semibold text-warhammer-gold mb-3">
            Beschreibung
          </h2>
          <div className="text-stone-300 leading-relaxed">
            <SafeMarkdown>{tournament.description}</SafeMarkdown>
          </div>
        </section>
      )}

      {tournament.rules && (
        <section className="mb-8">
          <h2 className="font-display text-xl font-semibold text-warhammer-gold mb-3">Regeln</h2>
          <div className="rounded-md border border-stone-800 bg-stone-900/50 p-6 text-stone-300 leading-relaxed">
            <SafeMarkdown>{tournament.rules}</SafeMarkdown>
          </div>
        </section>
      )}

      {(tournament.status === 'ONGOING' || tournament.status === 'COMPLETED') && (
        <section>
          <h2 className="font-display text-xl font-semibold text-warhammer-gold mb-3">Bracket</h2>
          <BracketView slug={tournament.slug} tournamentId={tournament.id} />
        </section>
      )}
    </main>
  );
}
