import { Link } from '@tanstack/react-router';
import { formatInUserTimezone } from '@/lib/timezone';

interface TournamentCardProps {
  tournament: {
    slug: string;
    name: string;
    format: string;
    status: string;
    start_date: string;
    organizer?: { username: string } | undefined;
    participantCount?: number | undefined;
  };
}

const FORMAT_LABELS: Record<string, string> = {
  SINGLE_ELIMINATION: 'Single Elim.',
  SWISS: 'Swiss',
  ROUND_ROBIN: 'Round Robin',
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-stone-700 text-stone-300',
  REGISTRATION: 'bg-emerald-800 text-emerald-200',
  ACTIVE: 'bg-warhammer-blood text-white',
  COMPLETED: 'bg-stone-600 text-stone-300',
  CANCELLED: 'bg-red-950 text-red-300',
};

export function TournamentCard({ tournament }: TournamentCardProps) {
  const startDate = formatInUserTimezone(tournament.start_date, undefined, { showTime: false });

  const statusColor = STATUS_COLORS[tournament.status] ?? 'bg-stone-700 text-stone-300';
  const formatLabel = FORMAT_LABELS[tournament.format] ?? tournament.format;

  return (
    <Link
      to="/tournaments/$slug"
      params={{ slug: tournament.slug }}
      className="block rounded-lg border border-stone-800 bg-stone-900 p-5 transition-colors hover:border-warhammer-gold hover:bg-stone-800"
    >
      <h3 className="font-display text-lg font-semibold text-warhammer-gold">{tournament.name}</h3>
      <div className="mt-2 flex flex-wrap gap-2">
        <span className="rounded px-2 py-0.5 text-xs font-medium bg-stone-700 text-stone-200">
          {formatLabel}
        </span>
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${statusColor}`}>
          {tournament.status}
        </span>
      </div>
      <p className="mt-3 text-sm text-stone-400">Start: {startDate}</p>
      {tournament.organizer && (
        <p className="mt-1 text-xs text-stone-500">von {tournament.organizer.username}</p>
      )}
      {tournament.participantCount !== undefined && (
        <p className="mt-1 text-xs text-stone-500">{tournament.participantCount} Teilnehmer</p>
      )}
    </Link>
  );
}
