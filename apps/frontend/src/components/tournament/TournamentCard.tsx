import { Link } from '@tanstack/react-router';
import { formatInUserTimezone } from '@/lib/timezone';
import { useAuthQuery } from '@/lib/auth';
import { DiscordTimestampButton } from './DiscordTimestampButton';

interface TournamentCardProps {
  tournament: {
    slug: string;
    name: string;
    poster_url?: string | null;
    format: string;
    mode?: string | null;
    status: string;
    start_date: string;
    timezone?: string;
    max_participants?: number | null;
    rounds_count?: number | null;
    faction_allowlist?: string[];
    host?: { username: string } | undefined;
    participantCount?: number | undefined;
  };
}

const FORMAT_LABELS: Record<string, string> = {
  AUTO_SWISS: 'Auto Swiss',
  SINGLE_ELIMINATION: 'Single Elim.',
  DOUBLE_ELIMINATION: 'Double Elim.',
  SWISS: 'Swiss',
  ROUND_ROBIN: 'Round Robin',
  LIECHTENSTEIN: 'Liechtenstein',
  BALANCED_LIECHTENSTEIN: 'Balanced Liechtenstein',
};

const MODE_LABELS: Record<string, string> = {
  SFT: 'SFT',
  BPT: 'BPT',
  SLT: 'SLT',
  MATRIX: 'Matrix',
  TWO_D_THREE: '2D3',
  BLIND_PICK: 'Blind Pick',
  ONE_V_ONE: '1v1',
  THREE_V_THREE: '3v3',
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  OPEN_REGISTRATION: 'Registration Open',
  REGISTRATION_CLOSED: 'Reg. Closed',
  ONGOING: 'Live',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-stone-700 text-stone-300',
  OPEN_REGISTRATION: 'bg-emerald-800 text-emerald-200',
  REGISTRATION_CLOSED: 'bg-yellow-900/60 text-yellow-300',
  ONGOING: 'bg-rizzotto-blood-500 text-white',
  COMPLETED: 'bg-stone-600 text-stone-300',
  CANCELLED: 'bg-red-950 text-red-300',
};

export function TournamentCard({ tournament }: TournamentCardProps) {
  const { data: user } = useAuthQuery();
  const startDate = formatInUserTimezone(tournament.start_date, user?.timezone ?? undefined);
  const statusColor = STATUS_COLORS[tournament.status] ?? 'bg-stone-700 text-stone-300';
  const statusLabel = STATUS_LABELS[tournament.status] ?? tournament.status;
  const formatLabel = FORMAT_LABELS[tournament.format] ?? tournament.format;
  const isAutoSwiss = tournament.format === 'AUTO_SWISS';
  const modeLabel = isAutoSwiss ? 'SFT' : (tournament.mode ? (MODE_LABELS[tournament.mode] ?? tournament.mode) : null);
  const roundsStarted = tournament.status === 'ONGOING' || tournament.status === 'COMPLETED';
  const roundsLabel = isAutoSwiss
    ? (roundsStarted && tournament.rounds_count ? `${tournament.rounds_count} Rounds` : 'Rounds TBD')
    : (tournament.rounds_count ? `${tournament.rounds_count} Rounds` : null);

  const bannedFactions = tournament.faction_allowlist && tournament.faction_allowlist.length > 0
    ? tournament.faction_allowlist
    : null;

  return (
    <Link
      to="/tournaments/$slug"
      params={{ slug: tournament.slug }}
      className="block rounded-lg border border-stone-800 bg-stone-900 p-5 transition-colors hover:border-rizzotto-gold-500 hover:bg-stone-800"
    >
      {tournament.poster_url && (
        <img
          src={tournament.poster_url}
          alt=""
          className="mb-3 h-28 w-full rounded object-cover"
          loading="lazy"
        />
      )}
      <h3 className="font-display text-lg font-semibold text-rizzotto-gold-500">
        {tournament.name}
      </h3>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className="rounded px-2 py-0.5 text-xs font-medium bg-stone-700 text-stone-200">
          {formatLabel}
        </span>
        {modeLabel && (
          <span className="rounded px-2 py-0.5 text-xs font-medium bg-stone-700 text-stone-200">
            {modeLabel}
          </span>
        )}
        {roundsLabel && (
          <span className="rounded px-2 py-0.5 text-xs font-medium bg-stone-700 text-stone-300">
            {roundsLabel}
          </span>
        )}
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${statusColor}`}>
          {statusLabel}
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-sm text-stone-400">{startDate}</p>
        <DiscordTimestampButton isoString={tournament.start_date} />
      </div>

      <div className="mt-1 flex items-center justify-between gap-2">
        {tournament.host && (
          <p className="text-xs text-stone-500">by {tournament.host.username}</p>
        )}
        {tournament.participantCount !== undefined && (
          <p className="text-xs text-stone-500">
            {tournament.participantCount}
            {tournament.max_participants ? ` / ${tournament.max_participants}` : ''} players
          </p>
        )}
      </div>

      {bannedFactions && (
        <p className="mt-1.5 text-xs text-stone-500">
          Allowed: {bannedFactions.join(', ')}
        </p>
      )}
    </Link>
  );
}
