import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { getQueueCount } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Hero CTA — live Open Play activity pulse. Replaces the launch-day countdown:
 * surfaces the current queue size (and, when the queue is empty, how many players
 * have availability this hour) to funnel visitors into Open Play. Public data,
 * polled every 10s; visible to guests and signed-in users alike.
 */
export function QueuePulse() {
  const { data } = useQuery({
    queryKey: ['queue-count'],
    queryFn: getQueueCount,
    refetchInterval: 10_000,
  });

  const queue = data?.queue ?? 0;
  const availableNow = data?.availableNow ?? 0;

  const primary =
    queue > 0
      ? { count: queue, label: queue === 1 ? 'player in queue' : 'players in queue' }
      : availableNow > 0
        ? { count: availableNow, label: availableNow === 1 ? 'player available now' : 'players available now' }
        : null;

  return (
    <Link
      to="/open-play"
      aria-label="Open Play"
      className={cn(
        'group block rounded-md border border-rizzotto-gold-700/60 bg-rizzotto-iron-900/70 px-6 py-4 text-center backdrop-blur-sm',
        'transition-colors duration-base ease-burn hover:border-rizzotto-gold-500 hover:bg-rizzotto-iron-900/85',
      )}
    >
      <div className="font-display text-xs uppercase tracking-[0.22em] text-rizzotto-gold-300">
        Open Play
      </div>

      <div className="mt-2.5 flex items-center justify-center gap-2.5">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
        </span>
        {primary ? (
          <span className="font-display text-2xl font-bold leading-none tabular-nums text-rizzotto-gold-400 sm:text-3xl">
            {primary.count}
            <span className="ml-2 align-middle text-xs font-normal uppercase tracking-[0.18em] text-rizzotto-stone-400">
              {primary.label}
            </span>
          </span>
        ) : (
          <span className="font-display text-base font-semibold uppercase tracking-[0.18em] text-rizzotto-stone-300">
            Queue is open
          </span>
        )}
      </div>

      <div className="mt-2.5 text-xs text-rizzotto-stone-400">
        <span className="text-rizzotto-gold-300 group-hover:underline">Join Open Play →</span>
      </div>
    </Link>
  );
}
