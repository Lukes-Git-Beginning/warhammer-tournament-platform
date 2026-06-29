import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Swords } from 'lucide-react';
import { getMyActiveMatches } from '@/lib/api';
import { useAuthQuery } from '@/lib/auth';
import { useVisibleMatchIds } from '@/contexts/ActiveMatchVisibility';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// N16: Active-Match Indicator
//
// Placed to the LEFT of the user avatar in the Header.  Only renders when the
// user is logged in.
//
// Behaviour:
//  - Polls GET /api/me/active-matches every 45 s (+ on window focus).
//  - Computes hidden = items whose matchId is NOT in the current visibleSet.
//  - Shows a crossed-swords icon that pulses when hidden.length > 0.
//  - Shows a count badge = items.length (total active, not just hidden).
//  - On HOVER: Popover listing all items with labels and navigate links.
//  - On CLICK: navigates to the first hidden item's destination.
// ---------------------------------------------------------------------------

function itemDestination(item: { kind: string; tournamentSlug: string | null }): string {
  if (item.kind === 'tournament' && item.tournamentSlug) {
    return `/tournaments/${item.tournamentSlug}`;
  }
  // open_play and challenge both send to Open Play
  return '/open-play';
}

export function ActiveMatchIndicator() {
  const { data: user } = useAuthQuery();
  const navigate = useNavigate();
  const visibleSet = useVisibleMatchIds();

  const { data } = useQuery({
    queryKey: ['me', 'active-matches'],
    queryFn: getMyActiveMatches,
    refetchInterval: 45_000,
    refetchOnWindowFocus: true,
    enabled: !!user,
  });

  const items = data?.items ?? [];

  if (!user || items.length === 0) return null;

  const hidden = items.filter((i) => !visibleSet.has(i.matchId));
  const isPulsing = hidden.length > 0;
  const firstHidden = hidden[0] ?? items[0];

  function handleClick() {
    if (!firstHidden) return;
    void navigate({ to: itemDestination(firstHidden) as '/' });
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={handleClick}
          aria-label={`${items.length} active match${items.length === 1 ? '' : 'es'}`}
          className={cn(
            'relative inline-flex items-center justify-center rounded-sm p-1.5 transition-colors',
            'text-rizzotto-stone-400 hover:text-rizzotto-gold-400',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rizzotto-gold-500 focus-visible:ring-offset-2 focus-visible:ring-offset-rizzotto-iron-950',
          )}
        >
          <Swords
            className={cn(
              'size-5',
              isPulsing
                ? 'text-rizzotto-gold-400 animate-pulse'
                : 'text-rizzotto-stone-500',
            )}
            strokeWidth={1.5}
            aria-hidden="true"
          />
          {/* Count badge */}
          <span
            className={cn(
              'absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center',
              'rounded-full px-0.5 text-[10px] font-bold leading-none',
              isPulsing
                ? 'bg-rizzotto-gold-500 text-rizzotto-iron-950'
                : 'bg-rizzotto-iron-600 text-rizzotto-stone-300',
            )}
          >
            {items.length}
          </span>
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-80 p-0 border-rizzotto-iron-600 bg-rizzotto-iron-900 text-rizzotto-stone-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-2 border-b border-rizzotto-iron-700">
          <p className="text-xs font-semibold uppercase tracking-wider text-rizzotto-stone-400">
            Active Matches
          </p>
        </div>
        <ul className="flex flex-col divide-y divide-rizzotto-iron-800 max-h-72 overflow-y-auto">
          {items.map((item) => {
            const dest = itemDestination(item);
            const isHidden = !visibleSet.has(item.matchId);
            return (
              <li key={item.matchId}>
                <a
                  href={dest}
                  onClick={(e) => {
                    e.preventDefault();
                    void navigate({ to: dest as '/' });
                  }}
                  className={cn(
                    'flex items-start gap-2 px-3 py-2 text-sm hover:bg-rizzotto-iron-800 transition-colors',
                    isHidden && 'border-l-2 border-rizzotto-gold-500',
                  )}
                >
                  <Swords
                    className={cn(
                      'mt-0.5 size-3.5 shrink-0',
                      isHidden ? 'text-rizzotto-gold-400' : 'text-rizzotto-stone-500',
                    )}
                    strokeWidth={1.5}
                  />
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="truncate text-rizzotto-stone-200 leading-tight">
                      {item.label}
                    </span>
                    <span className="text-xs text-rizzotto-stone-500 uppercase tracking-wider">
                      {item.status}
                    </span>
                  </div>
                </a>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
