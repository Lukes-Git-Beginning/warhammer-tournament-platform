import { Coffee, Crown, Trophy } from 'lucide-react';

/** A player's cumulative supporter tiers — a user can hold any combination. */
export interface SupporterTiers {
  supporter: boolean;
  lord: boolean;
  champion: boolean;
}

/** One supporter as returned by GET /api/supporters. */
export interface SupporterEntry {
  userId: string;
  username: string;
  avatarUrl: string | null;
  tiers: SupporterTiers;
}

// Highest first (Champion → Lord → Supporter). Icons from Lucide (device-consistent).
// `hint` is the mouse-over legend: it explains what each tier means, not just its name.
const TIER_META = [
  {
    key: 'champion',
    Icon: Trophy,
    label: 'Champion',
    hint: 'Champion — gave a large one-time donation (€50+)',
    className: 'text-red-500',
  },
  {
    key: 'lord',
    Icon: Crown,
    label: 'Lord',
    hint: 'Lord — an active monthly supporter',
    className: 'text-yellow-400',
  },
  {
    key: 'supporter',
    Icon: Coffee,
    label: 'Supporter',
    hint: 'Supporter — donated at least one coffee',
    className: 'text-amber-600',
  },
] as const;

/** Renders the icons for every tier a player holds (nothing if they hold none). */
export function SupporterBadge({ tiers, size = 16 }: { tiers: SupporterTiers; size?: number }) {
  const held = TIER_META.filter((t) => tiers[t.key]);
  if (held.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      {held.map(({ key, Icon, hint, className }) => (
        <span key={key} title={hint} className="inline-flex">
          <Icon size={size} strokeWidth={1.75} className={className} aria-label={hint} />
        </span>
      ))}
    </span>
  );
}
