import { Fragment } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { BracketNode } from '@rizzotto/types';
import type { TournamentParticipantEntry } from '@/lib/api';
import { dropParticipant } from '@/lib/api';
import { getEliminationPlacements } from '@/lib/bracketStandings';

interface EliminationStandingsProps {
  matches: BracketNode[];
  participants: TournamentParticipantEntry[];
  slug: string;
  canManage?: boolean;
  tournamentStatus?: string;
}

const PLACEMENT_BADGE: Record<1 | 2 | 3 | 4, { label: string; className: string }> = {
  1: { label: '1ST', className: 'text-rizzotto-gold-400 border-rizzotto-gold-500/50 bg-rizzotto-gold-500/10' },
  2: { label: '2ND', className: 'text-stone-300 border-stone-500/40 bg-stone-700/20' },
  3: { label: '3RD', className: 'text-orange-500 border-orange-700/40 bg-orange-950/30' },
  4: { label: '4TH', className: 'text-stone-500 border-stone-700/40 bg-stone-900/20' },
};

function Divider({ label }: { label: string }) {
  return (
    <li className="flex items-center gap-2 border-y border-rizzotto-gold-500/20 bg-rizzotto-gold-500/5 px-4 py-1.5">
      <span className="h-px flex-1 bg-rizzotto-gold-500/20" />
      <span className="text-[10px] font-bold uppercase tracking-widest text-rizzotto-gold-500/70">
        {label}
      </span>
      <span className="h-px flex-1 bg-rizzotto-gold-500/20" />
    </li>
  );
}

export function EliminationStandings({
  matches,
  participants,
  slug,
  canManage = false,
  tournamentStatus,
}: EliminationStandingsProps) {
  const queryClient = useQueryClient();

  const dropMutation = useMutation({
    mutationFn: (userId: string) => dropParticipant(slug, userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tournament-participants', slug] });
      void queryClient.invalidateQueries({ queryKey: ['bracket', slug] });
      void queryClient.invalidateQueries({ queryKey: ['tournament', slug] });
    },
  });

  const active = participants.filter(
    (p) => p.status !== 'WITHDREW' && p.status !== 'DISQUALIFIED',
  );
  const inactive = participants.filter(
    (p) => p.status === 'WITHDREW' || p.status === 'DISQUALIFIED',
  );

  const { placements, lastCompletedRound, gfParticipants } = getEliminationPlacements(matches);

  // Sort active participants by placement data
  const sorted = [...active].sort((a, b) => {
    const pa = placements.get(a.user.id);
    const pb = placements.get(b.user.id);
    if (pa !== undefined && pb !== undefined) return pa - pb;
    if (pa !== undefined) return -1;
    if (pb !== undefined) return 1;
    const ra = lastCompletedRound.get(a.user.id) ?? -1;
    const rb = lastCompletedRound.get(b.user.id) ?? -1;
    return rb - ra; // higher round = better
  });

  const showDropButtons = canManage && tournamentStatus === 'ONGOING';

  const gfDividerAfter = (() => {
    // Insert GF divider after the last GF participant in the sorted list
    const lastGfIdx = sorted.reduce(
      (acc, p, i) => (gfParticipants.has(p.user.id) ? i : acc),
      -1,
    );
    return lastGfIdx >= 0 ? lastGfIdx : -1;
  })();

  function renderRow(p: TournamentParticipantEntry, dimmed = false) {
    const placement = placements.get(p.user.id) as 1 | 2 | 3 | 4 | undefined;
    const badge = placement ? PLACEMENT_BADGE[placement] : null;
    const isGfRow = gfParticipants.has(p.user.id);
    const canDrop = showDropButtons && !dimmed;

    return (
      <li
        key={p.id}
        className={[
          'flex items-center gap-3 px-4 py-2.5 transition-colors',
          dimmed ? 'opacity-50' : '',
          isGfRow && !dimmed ? 'bg-rizzotto-gold-500/5' : '',
        ].join(' ')}
      >
        {p.user.avatar_url ? (
          <img
            src={p.user.avatar_url}
            alt=""
            className="h-7 w-7 rounded-full object-cover shrink-0"
            loading="lazy"
          />
        ) : (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-rizzotto-iron-600 text-xs font-semibold text-rizzotto-stone-300">
            {p.user.username.slice(0, 2).toUpperCase()}
          </span>
        )}

        <Link
          to="/users/$id"
          params={{ id: p.user.id }}
          className={[
            'text-sm text-rizzotto-stone-200 hover:text-rizzotto-gold-400 transition-colors',
            dimmed ? 'line-through' : '',
          ].join(' ')}
        >
          {p.user.username}
        </Link>

        {badge && !dimmed && (
          <span
            className={`ml-0.5 rounded border px-1.5 py-px text-[10px] font-bold uppercase tracking-wider ${badge.className}`}
          >
            {badge.label}
          </span>
        )}

        {p.faction && (
          <Link
            to="/factions/$id"
            params={{ id: p.faction.id }}
            className="flex items-center gap-1.5 text-xs text-rizzotto-stone-400 hover:text-rizzotto-gold-400 transition-colors"
          >
            <span
              className="inline-block h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: p.faction.color_hex }}
              aria-hidden="true"
            />
            {p.faction.name}
          </Link>
        )}

        {dimmed && (
          <span className="ml-auto text-xs text-rizzotto-stone-500 capitalize">
            {p.status.toLowerCase()}
          </span>
        )}

        {canDrop && (
          <button
            type="button"
            disabled={dropMutation.isPending}
            className="ml-auto rounded border border-red-900 px-2 py-0.5 text-xs text-red-500 hover:border-red-600 hover:text-red-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => {
              if (confirm(`Drop ${p.user.username} from the tournament? Any open matches will be awarded to their opponent.`)) {
                dropMutation.mutate(p.user.id);
              }
            }}
          >
            Drop
          </button>
        )}
      </li>
    );
  }

  if (participants.length === 0) {
    return (
      <section className="mb-8">
        <h2 className="font-display text-xl font-semibold text-rizzotto-gold-500 mb-3">
          Participants (0)
        </h2>
        <p className="text-sm text-rizzotto-stone-500">No participants yet.</p>
      </section>
    );
  }

  return (
    <section className="mb-8">
      <h2 className="font-display text-xl font-semibold text-rizzotto-gold-500 mb-3">
        Participants ({participants.length})
      </h2>
      <ul className="divide-y divide-rizzotto-iron-600 rounded-md border border-rizzotto-iron-600 bg-rizzotto-iron-900 overflow-hidden">
        {sorted.map((p, i) => (
          <Fragment key={p.id}>
            {renderRow(p)}
            {i === gfDividerAfter && gfParticipants.size === 2 && sorted.length > gfDividerAfter + 1 && (
              <Divider label="Grand Final" />
            )}
          </Fragment>
        ))}
        {inactive.map((p) => renderRow(p, true))}
      </ul>
    </section>
  );
}
