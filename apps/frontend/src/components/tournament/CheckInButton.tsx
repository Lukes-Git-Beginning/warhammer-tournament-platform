import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { selfCheckIn } from '@/lib/api';
import type { Tournament, ParticipantStatus } from '@/lib/api';
import { Button } from '@/components/ui/button';

export interface CheckInButtonProps {
  tournament: Tournament;
  participantStatus: ParticipantStatus;
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '0s';
  const totalSecs = Math.floor(ms / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * Self-Service Check-in button with live countdown.
 *
 * States:
 * - Before window: gray "Check-in opens in Xm Ys"
 * - Window open + REGISTERED: green "Check in now! (Xm left)"
 * - CHECKED_IN: solid "You're checked in (Xm to start)"
 * - After window: red "Check-in closed"
 */
export function CheckInButton({ tournament, participantStatus }: CheckInButtonProps) {
  const queryClient = useQueryClient();
  const [now, setNow] = useState(() => Date.now());

  // Live clock
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const startMs = new Date(tournament.start_date).getTime();
  const windowOpensMs = startMs - 60 * 60 * 1000; // T-60min
  const windowClosesMs = startMs;

  const checkIn = useMutation({
    mutationFn: () => selfCheckIn(tournament.slug),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tournament', tournament.slug] });
      void queryClient.invalidateQueries({ queryKey: ['tournament-participants', tournament.slug] });
    },
  });

  // Already checked in — always show (even after window closes)
  if (participantStatus === 'CHECKED_IN') {
    const msToStart = startMs - now;
    return (
      <div className="flex items-center gap-2 rounded-md border border-rizzotto-success/40 bg-rizzotto-success/10 px-4 py-2.5">
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-4 w-4 text-rizzotto-success shrink-0"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
            clipRule="evenodd"
          />
        </svg>
        <span className="text-sm font-semibold text-rizzotto-success">
          You're checked in
          {msToStart > 0 && (
            <span className="ml-1 font-normal text-rizzotto-stone-400">
              ({formatDuration(msToStart)} to start)
            </span>
          )}
        </span>
      </div>
    );
  }

  // Window not yet open
  if (now < windowOpensMs) {
    const msUntilOpen = windowOpensMs - now;
    return (
      <div className="flex items-center gap-2 rounded-md border border-rizzotto-iron-600 bg-rizzotto-iron-900 px-4 py-2.5">
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-4 w-4 text-rizzotto-stone-500 shrink-0"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-13a.75.75 0 0 0-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 0 0 0-1.5h-3.25V5Z"
            clipRule="evenodd"
          />
        </svg>
        <span className="text-sm text-rizzotto-stone-400">
          Check-in opens in{' '}
          <span className="font-semibold text-rizzotto-stone-300 tabular-nums">
            {formatDuration(msUntilOpen)}
          </span>
        </span>
      </div>
    );
  }

  // Window closed
  if (now >= windowClosesMs) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-rizzotto-blood-500/40 bg-rizzotto-blood-500/10 px-4 py-2.5">
        <span className="text-sm text-rizzotto-blood-500 font-semibold">Check-in closed</span>
      </div>
    );
  }

  // Window open — REGISTERED
  if (participantStatus === 'REGISTERED') {
    const msLeft = windowClosesMs - now;
    return (
      <div className="flex items-center gap-3">
        <Button
          variant="forge"
          size="md"
          disabled={checkIn.isPending}
          onClick={() => checkIn.mutate()}
        >
          {checkIn.isPending ? 'Checking in…' : 'Check in now!'}
        </Button>
        <span className="text-xs text-rizzotto-stone-500 tabular-nums">
          {formatDuration(msLeft)} left
        </span>
        {checkIn.isError && (
          <span className="text-xs text-rizzotto-danger">
            {(checkIn.error as Error).message}
          </span>
        )}
      </div>
    );
  }

  // Withdrawn / Disqualified — no action
  return null;
}
