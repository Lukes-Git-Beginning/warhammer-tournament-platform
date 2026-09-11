import { Swords, Castle, type LucideIcon } from 'lucide-react';

// Distinguishing marks for a tournament's two new axes — battle type (Conquest/Siege) and
// team size (2v2). Domination + 1v1 is the norm and stays visually UNCHANGED: the helper
// returns no accent and the component renders nothing for it.

type BattleMeta = { label: string; icon: LucideIcon; badge: string };

const BATTLE_TYPE_META: Record<string, BattleMeta> = {
  CONQUEST: { label: 'Conquest', icon: Swords, badge: 'bg-emerald-900/70 text-emerald-200 border-emerald-600/50' },
  SIEGE: { label: 'Siege', icon: Castle, badge: 'bg-orange-900/70 text-orange-200 border-orange-600/50' },
};

/** Left-accent border class for the non-default battle types (empty string for Domination). */
export function battleTypeAccent(battleType?: string | null): string {
  if (battleType === 'CONQUEST') return 'border-l-4 border-l-emerald-600/70';
  if (battleType === 'SIEGE') return 'border-l-4 border-l-orange-600/70';
  return '';
}

export function TournamentTypeBadges({
  battleType,
  competitorFormat,
  className,
}: {
  battleType?: string | null;
  competitorFormat?: string | null;
  className?: string;
}) {
  const bt = battleType && battleType !== 'DOMINATION' ? BATTLE_TYPE_META[battleType] : undefined;
  const is2v2 = competitorFormat === 'TWO_V_TWO';
  if (!bt && !is2v2) return null;
  const Icon = bt?.icon;
  return (
    <div className={`flex flex-wrap gap-1.5 ${className ?? ''}`}>
      {is2v2 && (
        <span className="inline-flex items-center rounded border border-violet-500/50 bg-violet-900/70 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-violet-200">
          2v2
        </span>
      )}
      {bt && Icon && (
        <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${bt.badge}`}>
          <Icon className="size-3" strokeWidth={1.5} />
          {bt.label}
        </span>
      )}
    </div>
  );
}
