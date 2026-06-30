import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import type { BracketNode, FactionDto } from '@rizzotto/types';
import { getTournamentMaps, reportMatchIssue } from '@/lib/api';
import { useAuthQuery } from '@/lib/auth';
import type { BracketPlayerInfo } from './SVGBracket';

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-rizzotto-iron-700 text-rizzotto-stone-400',
  ONGOING: 'bg-rizzotto-gold-500/20 text-rizzotto-gold-400 border border-rizzotto-gold-500/40',
  COMPLETED: 'bg-rizzotto-iron-700 text-rizzotto-stone-300',
  BYE: 'bg-rizzotto-iron-700 text-rizzotto-stone-400',
  FORFEIT: 'bg-red-900/40 text-red-300',
  DISPUTED: 'bg-orange-900/40 text-orange-300',
  CANCELLED: 'bg-rizzotto-iron-800 text-rizzotto-stone-500',
};

function PlayerAvatar({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-rizzotto-iron-600"
        loading="lazy"
        decoding="async"
      />
    );
  }
  return (
    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rizzotto-iron-700 text-xs font-bold text-rizzotto-stone-300 ring-1 ring-rizzotto-iron-600 select-none">
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

function FactionChip({ faction }: { faction: FactionDto | undefined }) {
  if (!faction) return <span className="text-xs text-rizzotto-stone-600">—</span>;
  return (
    <Link
      to="/factions/$id"
      params={{ id: faction.id }}
      className="inline-flex items-center gap-1.5 transition-opacity hover:opacity-80"
    >
      {faction.icon_url ? (
        <img src={faction.icon_url} alt={faction.name} className="h-4 w-4 rounded-full object-cover" loading="lazy" />
      ) : (
        <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-rizzotto-iron-600 text-[8px] font-bold text-rizzotto-stone-200 select-none">
          {faction.initials}
        </span>
      )}
      <span className="text-xs text-rizzotto-stone-400">{faction.name}</span>
    </Link>
  );
}

interface MatchReadOnlyModalProps {
  match: BracketNode;
  slug: string;
  players: Map<string, BracketPlayerInfo>;
  factionMap: Map<string, FactionDto>;
  onClose: () => void;
}

export function MatchReadOnlyModal({ match, slug, players, factionMap, onClose }: MatchReadOnlyModalProps) {
  const { data: user } = useAuthQuery();
  const [showReport, setShowReport] = useState(false);
  const [comment, setComment] = useState('');

  const isParticipant =
    !!user && (user.id === match.player1Id || user.id === match.player2Id);

  const { data: mapsData } = useQuery({
    queryKey: ['tournament-maps', slug],
    queryFn: () => getTournamentMaps(slug),
    enabled: !!match.pickedMapId,
    staleTime: 60 * 60_000,
  });
  const pickedMap = match.pickedMapId
    ? (mapsData?.data ?? []).find((m) => m.id === match.pickedMapId)
    : undefined;

  const reportMutation = useMutation({
    mutationFn: () => reportMatchIssue(match.matchId, comment.trim()),
  });

  const statusCls = STATUS_STYLES[match.status] ?? STATUS_STYLES.PENDING;
  const score =
    match.score ?? `${match.player1GameWins}-${match.player2GameWins}`;

  const renderSide = (
    playerId: string | null,
    factionId: string | null,
  ) => {
    const info = playerId ? players.get(playerId) : undefined;
    const isWinner = !!match.winnerId && match.winnerId === playerId;
    return (
      <div className="flex items-center gap-3 py-2">
        <PlayerAvatar name={info?.name ?? 'TBD'} avatarUrl={info?.avatarUrl ?? null} />
        <div className="min-w-0 flex-1">
          {playerId ? (
            <Link
              to="/users/$id"
              params={{ id: playerId }}
              className={`block truncate text-sm font-semibold hover:underline ${isWinner ? 'text-rizzotto-gold-400' : 'text-rizzotto-stone-200'}`}
            >
              {info?.name ?? 'Unknown'}
            </Link>
          ) : (
            <span className="block truncate text-sm font-semibold text-rizzotto-stone-500">TBD</span>
          )}
          <FactionChip faction={factionId ? factionMap.get(factionId) : undefined} />
        </div>
        {isWinner && (
          <span className="shrink-0 text-xs font-bold uppercase tracking-wider text-rizzotto-gold-400">Win</span>
        )}
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-rizzotto-iron-600 bg-rizzotto-iron-900 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-base font-semibold text-rizzotto-gold-400">Match Details</h3>
          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider ${statusCls}`}>
            {match.status}
          </span>
        </div>

        <div className="divide-y divide-rizzotto-iron-700/60 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-950/40 px-3">
          {renderSide(match.player1Id, match.player1FactionId)}
          <div className="flex items-center justify-center py-1">
            <span className="font-display text-lg font-bold tabular-nums text-rizzotto-stone-300">{score}</span>
          </div>
          {renderSide(match.player2Id, match.player2FactionId)}
        </div>

        {pickedMap && (
          <div className="mt-3 flex items-center gap-2.5">
            {pickedMap.image_url && (
              <img src={pickedMap.image_url} alt={pickedMap.name} className="h-9 w-14 rounded object-cover ring-1 ring-rizzotto-iron-600" loading="lazy" />
            )}
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-rizzotto-stone-500">Map</div>
              <div className="text-sm text-rizzotto-stone-300">{pickedMap.name}</div>
            </div>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-3">
          <Link
            to="/matches/$matchId"
            params={{ matchId: match.matchId }}
            className="text-xs text-rizzotto-gold-300 hover:underline"
          >
            View full details →
          </Link>
          {isParticipant && !showReport && !reportMutation.isSuccess && (
            <button
              type="button"
              onClick={() => setShowReport(true)}
              className="text-xs text-rizzotto-stone-400 underline-offset-2 hover:text-rizzotto-stone-200 hover:underline"
            >
              Report an issue
            </button>
          )}
        </div>

        {isParticipant && showReport && !reportMutation.isSuccess && (
          <div className="mt-3 border-t border-rizzotto-iron-700 pt-3">
            <label className="mb-1.5 block text-xs text-rizzotto-stone-400">
              Describe the issue — the host will be notified.
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="e.g. the score is wrong, my faction is incorrect…"
              className="w-full resize-none rounded-md border border-rizzotto-iron-600 bg-rizzotto-iron-950 px-2.5 py-2 text-sm text-rizzotto-stone-200 placeholder:text-rizzotto-stone-600 focus:border-rizzotto-gold-600 focus:outline-none"
            />
            {reportMutation.isError && (
              <p className="mt-1 text-xs text-red-400">Could not submit. Please try again.</p>
            )}
            <div className="mt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => { setShowReport(false); setComment(''); }}
                className="rounded-md px-3 py-1.5 text-xs text-rizzotto-stone-400 hover:text-rizzotto-stone-200"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={comment.trim().length === 0 || reportMutation.isPending}
                onClick={() => reportMutation.mutate()}
                className="rounded-md bg-rizzotto-gold-700 px-3 py-1.5 text-xs font-semibold text-rizzotto-iron-950 transition-colors hover:bg-rizzotto-gold-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {reportMutation.isPending ? 'Sending…' : 'Send report'}
              </button>
            </div>
          </div>
        )}

        {reportMutation.isSuccess && (
          <p className="mt-3 border-t border-rizzotto-iron-700 pt-3 text-xs text-emerald-400">
            Issue reported — a host has been notified.
          </p>
        )}
      </div>
    </div>
  );
}
