import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getQueueStatus, leaveQueue } from '../../lib/api';

export function QueueStatusCard() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['queue-status'],
    queryFn: getQueueStatus,
    refetchInterval: 5000,
  });

  const leave = useMutation({
    mutationFn: leaveQueue,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['queue-status'] }),
  });

  if (!data?.inQueue) return null;

  return (
    <div className="flex items-center justify-between rounded border border-amber-500/30 bg-amber-500/10 px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
        </span>
        <span className="text-sm text-stone-200">
          In queue{' '}
          <span className="text-xs text-stone-500">
            #{data.position} of {data.total}
          </span>
        </span>
      </div>
      <button
        type="button"
        onClick={() => leave.mutate()}
        disabled={leave.isPending}
        className="text-xs text-stone-400 hover:text-red-400 transition-colors"
      >
        Leave
      </button>
    </div>
  );
}
