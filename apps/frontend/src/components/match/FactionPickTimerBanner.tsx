import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { getPendingFactionPicks, type PendingFactionPick } from '@/lib/api';
import { useAuthQuery } from '@/lib/auth';

/**
 * #2 — Site-wide faction-pick timer. Blind picks auto-resolve to a random faction
 * two minutes after the opponent locks. Players kept missing that window because
 * the countdown only lived on the picker screen. This always-visible pill polls the
 * user's running pick timers and surfaces the soonest one anywhere on the site,
 * linking straight to the picker. Renders nothing when no timer is running.
 */
export function FactionPickTimerBanner() {
  const { data: user } = useAuthQuery();

  const { data } = useQuery({
    queryKey: ['pending-faction-picks'],
    queryFn: getPendingFactionPicks,
    enabled: Boolean(user),
    refetchInterval: 8000,
  });

  const picks = data?.picks ?? [];
  // The soonest-expiring pick is the most urgent — it drives the pill.
  const next = picks.reduce<PendingFactionPick | null>(
    (soonest, p) => (!soonest || p.deadline < soonest.deadline ? p : soonest),
    null,
  );

  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    if (!next) {
      setLabel(null);
      return;
    }
    const target = new Date(next.deadline).getTime();
    function tick() {
      const diff = target - Date.now();
      if (diff <= 0) {
        setLabel(null);
        return;
      }
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setLabel(`${m}:${s.toString().padStart(2, '0')}`);
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [next?.deadline]);

  if (!next || !label) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-3">
      <Link
        to="/matches/$matchId/decision"
        params={{ matchId: next.matchId }}
        className="pointer-events-auto flex items-center gap-3 rounded-full border border-rizzotto-gold-500 bg-rizzotto-iron-900/95 px-5 py-2 text-sm font-semibold text-rizzotto-gold-300 shadow-lg shadow-black/40 backdrop-blur transition-colors hover:bg-rizzotto-iron-800"
      >
        <span className="animate-pulse text-base" aria-hidden="true">
          ⏱
        </span>
        <span>
          Pick your faction —{' '}
          <span className="tabular-nums text-rizzotto-gold-100">{label}</span> left
          {next.tournamentName ? (
            <span className="hidden text-rizzotto-stone-400 sm:inline"> · {next.tournamentName}</span>
          ) : null}
        </span>
        <span className="rounded bg-rizzotto-gold-500 px-2 py-0.5 text-xs text-rizzotto-iron-950">
          Pick now →
        </span>
      </Link>
    </div>
  );
}
