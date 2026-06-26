import { useState, useEffect } from 'react';
import { Link } from '@tanstack/react-router';
import { cn } from '@/lib/utils';

/**
 * TEMPORARY launch-day CTA — replaces the "View the Leaderboard" hero button
 * until the Grand Launch Tournament is over. Counts down to the absolute start
 * instant (timezone-correct for every visitor) and links to the tournament.
 *
 * To revert after the event: in HeroSection.tsx restore the leaderboard
 * `<Button asChild variant="iron">…/leaderboard…</Button>` and delete this file.
 */
const LAUNCH_AT = new Date('2026-06-27T20:00:00Z'); // 22:00 CEST
const TOURNEY_SLUG = 'rizzottos-arena-grand-launch-tournament-swiss-bpt';

export function LaunchCountdown() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const diff = Math.max(0, LAUNCH_AT.getTime() - now);
  const live = diff <= 0;
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1_000);
  const pad = (n: number) => String(n).padStart(2, '0');

  // Visitor-local start time (each visitor sees their own timezone).
  const localTime = LAUNCH_AT.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  const Unit = ({ value, label }: { value: number; label: string }) => (
    <div className="flex flex-col items-center">
      <span className="font-display text-3xl font-bold leading-none tabular-nums text-rizzotto-gold-400 sm:text-4xl">
        {pad(value)}
      </span>
      <span className="mt-1 text-[10px] uppercase tracking-[0.2em] text-rizzotto-stone-400">{label}</span>
    </div>
  );
  const Sep = () => <span className="text-2xl leading-none text-rizzotto-stone-600 sm:text-3xl">:</span>;

  return (
    <Link
      to="/tournaments/$slug"
      params={{ slug: TOURNEY_SLUG }}
      aria-label="Grand Launch Tournament"
      className={cn(
        'group block rounded-md border border-rizzotto-gold-700/60 bg-rizzotto-iron-900/70 px-6 py-4 text-center backdrop-blur-sm',
        'transition-colors duration-base ease-burn hover:border-rizzotto-gold-500 hover:bg-rizzotto-iron-900/85',
      )}
    >
      <div className="font-display text-xs uppercase tracking-[0.22em] text-rizzotto-gold-300">
        {live ? 'The Grand Launch Tournament is live' : 'Grand Launch Tournament begins in'}
      </div>

      {!live && (
        <div className="mt-2.5 flex items-center justify-center gap-3 sm:gap-4">
          <Unit value={d} label="Days" />
          <Sep />
          <Unit value={h} label="Hrs" />
          <Sep />
          <Unit value={m} label="Min" />
          <Sep />
          <Unit value={s} label="Sec" />
        </div>
      )}

      <div className="mt-2.5 text-xs text-rizzotto-stone-400">
        {live ? (
          <span className="text-rizzotto-gold-300 group-hover:underline">Join now →</span>
        ) : (
          <>
            {localTime} ·{' '}
            <span className="text-rizzotto-gold-300 group-hover:underline">View tournament →</span>
          </>
        )}
      </div>
    </Link>
  );
}
