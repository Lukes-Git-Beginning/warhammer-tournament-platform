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
const TIER_META = [
  { key: 'champion', Icon: Trophy, label: 'Champion', className: 'text-red-500' },
  { key: 'lord', Icon: Crown, label: 'Lord', className: 'text-yellow-400' },
  { key: 'supporter', Icon: Coffee, label: 'Supporter', className: 'text-amber-600' },
] as const;

/** Renders the icons for every tier a player holds (nothing if they hold none). */
export function SupporterBadge({ tiers, size = 16 }: { tiers: SupporterTiers; size?: number }) {
  const held = TIER_META.filter((t) => tiers[t.key]);
  if (held.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      {held.map(({ key, Icon, label, className }) => (
        <span key={key} title={label} className="inline-flex">
          <Icon size={size} strokeWidth={1.75} className={className} aria-label={label} />
        </span>
      ))}
    </span>
  );
}
