import { useQuery } from '@tanstack/react-query';
import { getFundingGoal } from '@/lib/api';

const CURRENCY_SYMBOL: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', CAD: 'CA$' };

function money(amount: number, currency: string): string {
  const sym = CURRENCY_SYMBOL[currency] ?? '';
  return `${sym}${amount.toLocaleString('en-US')}`;
}

/**
 * On-site funding progress bar — visualises how far the campaign has come toward its
 * goal. Reads the admin-set goal + amount raised (public endpoint). Renders nothing
 * until data is available or when no goal is set.
 */
export function FundingGoalBar({ className = '' }: { className?: string }) {
  const { data } = useQuery({
    queryKey: ['funding-goal'],
    queryFn: getFundingGoal,
    staleTime: 5 * 60 * 1000,
  });
  if (!data || data.goal <= 0) return null;

  const pct = Math.max(0, Math.min(100, Math.round((data.raised / data.goal) * 100)));

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-display text-sm font-semibold text-rizzotto-gold-300">
          {money(data.raised, data.currency)} raised
        </span>
        <span className="text-xs text-rizzotto-stone-400 sm:text-sm">
          Goal {money(data.goal, data.currency)} · {pct}%
        </span>
      </div>
      <div
        className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full border border-rizzotto-gold-700/40 bg-rizzotto-iron-900/70"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Funding progress"
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-rizzotto-gold-500 to-rizzotto-forge-500 transition-[width] duration-700 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
