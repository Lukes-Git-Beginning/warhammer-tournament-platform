import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { getParticipants, dropParticipant, undropParticipant, addLateJoiner } from '@/lib/api';

export interface ParticipantsListProps {
  slug: string;
  canManage?: boolean;
  tournamentStatus?: string;
}

/**
 * Public participant roster for a tournament.
 * Shows avatar/initials, username (links to profile), faction and status.
 * Withdrawn/disqualified entries render dimmed with strikethrough.
 * When canManage=true and tournament is ONGOING, shows a Drop button per active participant.
 */
export function ParticipantsList({ slug, canManage = false, tournamentStatus }: ParticipantsListProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['tournament-participants', slug],
    queryFn: () => getParticipants(slug),
  });

  const dropMutation = useMutation({
    mutationFn: (userId: string) => dropParticipant(slug, userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tournament-participants', slug] });
      void queryClient.invalidateQueries({ queryKey: ['bracket', slug] });
      void queryClient.invalidateQueries({ queryKey: ['tournament', slug] });
    },
  });

  const undropMutation = useMutation({
    mutationFn: (userId: string) => undropParticipant(slug, userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tournament-participants', slug] });
      void queryClient.invalidateQueries({ queryKey: ['bracket', slug] });
    },
  });

  const lateJoinMutation = useMutation({
    mutationFn: (userId: string) => addLateJoiner(slug, userId),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['tournament-participants', slug] });
      void queryClient.invalidateQueries({ queryKey: ['bracket', slug] });
      alert(`${data.participant.user.username} added as late joiner.`);
    },
    onError: (err: Error) => alert(`Error: ${err.message}`),
  });

  if (isLoading || !data) return null;

  const showDropButtons = canManage && tournamentStatus === 'ONGOING';

  return (
    <section className="mb-8">
      <h2 className="font-display text-xl font-semibold text-rizzotto-gold-500 mb-3">
        {t('tournament.participants.heading', { count: data.total })}
      </h2>
      {data.total === 0 ? (
        <p className="text-sm text-rizzotto-stone-500">{t('tournament.participants.empty')}</p>
      ) : (
        <ul className="divide-y divide-rizzotto-iron-600 rounded-md border border-rizzotto-iron-600 bg-rizzotto-iron-900">
          {data.data.map((p) => {
            const inactive = p.status === 'WITHDREW' || p.status === 'DISQUALIFIED';
            const canDrop = showDropButtons && !inactive;
            const canUndrop = showDropButtons && p.status === 'WITHDREW';
            return (
              <li
                key={p.id}
                className={`flex items-center gap-3 px-4 py-2.5 ${inactive ? 'opacity-50' : ''}`}
              >
                {p.user.avatar_url ? (
                  <img
                    src={p.user.avatar_url}
                    alt=""
                    className="h-7 w-7 rounded-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-rizzotto-iron-600 text-xs font-semibold text-rizzotto-stone-300">
                    {p.user.username.slice(0, 2).toUpperCase()}
                  </span>
                )}
                <Link
                  to="/users/$id"
                  params={{ id: p.user.id }}
                  className={`text-sm text-rizzotto-stone-200 hover:text-rizzotto-gold-400 transition-colors ${inactive ? 'line-through' : ''}`}
                >
                  {p.user.username}
                </Link>
                {p.faction && (
                  <span className="flex items-center gap-1.5 text-xs text-rizzotto-stone-400">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: p.faction.color_hex }}
                      aria-hidden="true"
                    />
                    {p.faction.name}
                  </span>
                )}
                <span className="ml-auto text-xs text-rizzotto-stone-500">
                  {t(`tournament.participants.status.${p.status.toLowerCase()}`)}
                </span>
                {canDrop && (
                  <button
                    type="button"
                    disabled={dropMutation.isPending}
                    className="ml-2 rounded border border-red-900 px-2 py-0.5 text-xs text-red-500 hover:border-red-600 hover:text-red-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() => {
                      if (confirm(`Drop ${p.user.username} from the tournament? Any open matches will be awarded to their opponent.`)) {
                        dropMutation.mutate(p.user.id);
                      }
                    }}
                  >
                    Drop
                  </button>
                )}
                {canUndrop && (
                  <button
                    type="button"
                    disabled={undropMutation.isPending}
                    className="ml-2 rounded border border-emerald-800 px-2 py-0.5 text-xs text-emerald-400 hover:border-emerald-600 hover:text-emerald-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() => {
                      if (confirm(`Undrop ${p.user.username}? Their FORFEIT matches are NOT automatically restored — fix those separately via the match modal.`)) {
                        undropMutation.mutate(p.user.id);
                      }
                    }}
                  >
                    Undrop
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {showDropButtons && (
        <div className="mt-3">
          <button
            type="button"
            disabled={lateJoinMutation.isPending}
            onClick={() => {
              const userId = prompt('Enter the User ID of the player to add (find it in Admin → Users):');
              if (userId?.trim()) lateJoinMutation.mutate(userId.trim());
            }}
            className="rounded border border-stone-600 px-3 py-1 text-xs text-stone-400 hover:border-stone-400 hover:text-stone-200 transition-colors disabled:opacity-40"
          >
            + Add Late Joiner / Sub
          </button>
        </div>
      )}
    </section>
  );
}
