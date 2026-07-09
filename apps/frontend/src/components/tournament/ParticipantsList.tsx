import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  getParticipants,
  dropParticipant,
  undropParticipant,
  getFactions,
  setParticipantFaction,
  removeParticipant,
  adminCheckIn,
} from '@/lib/api';

export interface ParticipantsListProps {
  slug: string;
  canManage?: boolean;
  tournamentStatus?: string;
  tournamentMode?: string;
}

// Modes where a participant registers with a single fixed faction a host may edit.
const FACTION_EDIT_MODES = new Set(['SFT', 'FREE_PICK']);

/**
 * Public participant roster for a tournament: avatar/initials, username (→ profile),
 * faction, and check-in status. Withdrawn/disqualified entries render dimmed.
 * When canManage=true: shows the check-in status per player, plus host actions —
 * force check-in, faction edit (SFT/Free Pick, incl. "pick-later"), drop/undrop, and
 * a pre-start "Remove" (full delete). (#29 / #30b / check-in visibility)
 */
export function ParticipantsList({ slug, canManage = false, tournamentStatus, tournamentMode }: ParticipantsListProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['tournament-participants', slug],
    queryFn: () => getParticipants(slug),
  });

  const showFactionEdit = canManage && !!tournamentMode && FACTION_EDIT_MODES.has(tournamentMode);
  const { data: factionsResp } = useQuery({
    queryKey: ['factions'],
    queryFn: () => getFactions(),
    enabled: showFactionEdit,
    staleTime: 5 * 60_000,
  });
  const factions = (factionsResp?.data ?? []).map((d) => d.faction);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['tournament-participants', slug] });
    void queryClient.invalidateQueries({ queryKey: ['bracket', slug] });
    void queryClient.invalidateQueries({ queryKey: ['tournament', slug] });
  };
  const dropMutation = useMutation({ mutationFn: (userId: string) => dropParticipant(slug, userId), onSuccess: invalidate });
  const undropMutation = useMutation({ mutationFn: (userId: string) => undropParticipant(slug, userId), onSuccess: invalidate });
  const checkInMutation = useMutation({ mutationFn: (userId: string) => adminCheckIn(slug, userId), onSuccess: invalidate });
  const removeMutation = useMutation({ mutationFn: (userId: string) => removeParticipant(slug, userId), onSuccess: invalidate });
  const setFactionMutation = useMutation({
    mutationFn: ({ userId, factionId }: { userId: string; factionId: string | null }) => setParticipantFaction(slug, userId, factionId),
    onSuccess: invalidate,
  });

  if (isLoading || !data) return null;

  const completed = tournamentStatus === 'COMPLETED';
  const preStart = tournamentStatus !== 'ONGOING' && tournamentStatus !== 'COMPLETED';
  const showDropButtons = canManage && !completed;

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display text-xl font-semibold text-rizzotto-gold-500">
          {t('tournament.participants.heading', { count: data.total })}
        </h2>
      </div>
      {data.total === 0 ? (
        <p className="text-sm text-rizzotto-stone-500">{t('tournament.participants.empty')}</p>
      ) : (
        <ul className="divide-y divide-rizzotto-iron-600 rounded-md border border-rizzotto-iron-600 bg-rizzotto-iron-900">
          {data.data.map((p) => {
            const inactive = p.status === 'WITHDREW' || p.status === 'DISQUALIFIED';
            const canDrop = showDropButtons && !inactive;
            const canUndrop = showDropButtons && p.status === 'WITHDREW';
            const showCheckIn = canManage && p.status === 'REGISTERED' && preStart;
            const showRemove = canManage && preStart;
            return (
              <li
                key={p.id}
                className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 ${inactive ? 'opacity-50' : ''}`}
              >
                {p.user.avatar_url ? (
                  <img src={p.user.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover" loading="lazy" />
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

                {showFactionEdit && !inactive ? (
                  <select
                    value={p.faction?.id ?? ''}
                    disabled={setFactionMutation.isPending}
                    onChange={(e) => setFactionMutation.mutate({ userId: p.user.id, factionId: e.target.value || null })}
                    className="rounded border border-rizzotto-iron-600 bg-rizzotto-iron-950 px-1.5 py-0.5 text-xs text-rizzotto-stone-300 focus:outline-none focus:ring-1 focus:ring-rizzotto-gold-500"
                    title="Change this player's faction (host)"
                  >
                    <option value="">— Free Pick (pick-later) —</option>
                    {factions.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                ) : p.faction ? (
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
                ) : null}

                <span className="ml-auto flex items-center gap-2">
                  {p.status === 'CHECKED_IN' ? (
                    <span className="rounded bg-emerald-900/40 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">✓ checked in</span>
                  ) : p.status === 'REGISTERED' ? (
                    <span className="rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">not checked in</span>
                  ) : (
                    <span className="text-xs text-rizzotto-stone-500">
                      {t(`tournament.participants.status.${p.status.toLowerCase()}`)}
                    </span>
                  )}
                </span>

                {showCheckIn && (
                  <button
                    type="button"
                    disabled={checkInMutation.isPending}
                    className="rounded border border-emerald-800 px-2 py-0.5 text-xs text-emerald-400 hover:border-emerald-600 hover:text-emerald-300 transition-colors disabled:opacity-50"
                    onClick={() => checkInMutation.mutate(p.user.id)}
                  >
                    Check in
                  </button>
                )}
                {canDrop && (
                  <button
                    type="button"
                    disabled={dropMutation.isPending}
                    className="rounded border border-red-900 px-2 py-0.5 text-xs text-red-500 hover:border-red-600 hover:text-red-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() => {
                      const msg = tournamentStatus === 'ONGOING'
                        ? `Drop ${p.user.username} from the tournament? Any open matches will be awarded to their opponent.`
                        : `Drop ${p.user.username} from the tournament? They won't be paired when it starts.`;
                      if (confirm(msg)) dropMutation.mutate(p.user.id);
                    }}
                  >
                    Drop
                  </button>
                )}
                {canUndrop && (
                  <button
                    type="button"
                    disabled={undropMutation.isPending}
                    className="rounded border border-emerald-800 px-2 py-0.5 text-xs text-emerald-400 hover:border-emerald-600 hover:text-emerald-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() => {
                      if (confirm(`Undrop ${p.user.username}? Their FORFEIT matches are NOT automatically restored — fix those separately via the match modal.`)) {
                        undropMutation.mutate(p.user.id);
                      }
                    }}
                  >
                    Undrop
                  </button>
                )}
                {showRemove && (
                  <button
                    type="button"
                    disabled={removeMutation.isPending}
                    className="rounded border border-red-800 px-2 py-0.5 text-xs text-red-400 hover:border-red-600 hover:text-red-300 transition-colors disabled:opacity-50"
                    onClick={() => {
                      if (confirm(`Remove ${p.user.username} entirely (as if never registered)? They can sign up again from scratch. Only possible before the tournament starts.`)) {
                        removeMutation.mutate(p.user.id);
                      }
                    }}
                  >
                    Remove
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
