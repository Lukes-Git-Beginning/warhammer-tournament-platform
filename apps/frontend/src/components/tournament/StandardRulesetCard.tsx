/**
 * N17 — the fixed "Community Standard" ruleset.
 *
 * Single source of truth, derived from the Total Tavern ruleset research
 * (tools/tt-ruleset-research). Rendered on the tournament detail page when
 * `standard_rules_enabled` is true, and as a preview in the create/edit forms.
 * The standard set is intentionally NOT editable — host customisations go into
 * the "Custom Rules" / "Custom Restrictions" fields.
 */

export const STANDARD_RULESET = {
  settings: ['Default Funds', 'Ultra Unit Scale', '1500 Tickets', 'Unit Caps On'],
  banned: ['Masque of Slaanesh', 'Dreadmaw'],
  conduct: ['10 minutes to ready up', '40 minute round limit'],
} as const;

function Row({ label, items }: { label: string; items: readonly string[] }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:gap-3">
      <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-rizzotto-gold-500/80 sm:w-24">
        {label}
      </span>
      <span className="text-stone-300">{items.join(' · ')}</span>
    </div>
  );
}

export function StandardRulesetCard({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`rounded-md border border-stone-800 bg-stone-900/50 text-sm leading-relaxed ${
        compact ? 'p-3' : 'p-6'
      }`}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="text-rizzotto-gold-400">⚔️</span>
        <span className="font-display font-semibold text-rizzotto-gold-500">Standard Ruleset</span>
      </div>
      <div className="space-y-1.5">
        <Row label="Settings" items={STANDARD_RULESET.settings} />
        <Row label="Banned" items={STANDARD_RULESET.banned} />
        <Row label="Conduct" items={STANDARD_RULESET.conduct} />
      </div>
    </div>
  );
}
