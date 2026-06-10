import { useMutation, useQueryClient } from '@tanstack/react-query';
import { acceptScheduledMatchup, cancelScheduledMatchup, type ScheduledMatchup } from '../../lib/api';
import { useNavigate } from '@tanstack/react-router';

interface ScheduledMatchupCardProps {
  matchup: ScheduledMatchup;
  currentUserId?: string;
}

export function ScheduledMatchupCard({ matchup, currentUserId }: ScheduledMatchupCardProps) {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const isOwn = currentUserId != null && matchup.proposer?.id === currentUserId;

  const accept = useMutation({
    mutationFn: () => acceptScheduledMatchup(matchup.id),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['scheduled-matchups'] });
      void navigate({ to: '/matches/$matchId', params: { matchId: data.match_id } });
    },
  });

  const cancel = useMutation({
    mutationFn: () => cancelScheduledMatchup(matchup.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scheduled-matchups'] }),
  });

  const proposedDate = new Date(matchup.proposed_at);

  return (
    <div className="flex items-center justify-between rounded border border-stone-700 bg-stone-900 px-4 py-3 gap-4">
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-stone-100 text-sm">{matchup.format}</span>
          {matchup.anonymous && (
            <span className="text-xs text-stone-500">anonymous</span>
          )}
        </div>
        <p className="text-xs text-stone-400">
          {proposedDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}{' '}
          at{' '}
          {proposedDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
          {matchup.proposer && !matchup.anonymous && (
            <> · by <span className="text-stone-300">{matchup.proposer.username}</span></>
          )}
        </p>
        {matchup.notes && (
          <p className="text-xs text-stone-500 truncate">{matchup.notes}</p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {isOwn ? (
          <button
            type="button"
            onClick={() => cancel.mutate()}
            disabled={cancel.isPending}
            className="text-xs text-stone-400 hover:text-red-400 transition-colors px-3 py-1.5 rounded border border-stone-700 hover:border-red-500/50"
          >
            Cancel
          </button>
        ) : currentUserId ? (
          <button
            type="button"
            onClick={() => accept.mutate()}
            disabled={accept.isPending}
            className="text-xs text-amber-400 hover:text-amber-300 transition-colors px-3 py-1.5 rounded border border-amber-500/50 hover:border-amber-400"
          >
            Accept
          </button>
        ) : null}
      </div>
    </div>
  );
}
