/**
 * The community "Standard Ruleset".
 *
 * Admin-editable via Admin → Settings (AdminConfig key `standard_ruleset`,
 * served by GET /api/meta/standard-ruleset). The card fetches the live values and
 * falls back to STANDARD_RULESET (the original Total Tavern research defaults) while
 * loading or if nothing is configured. Pass an explicit `ruleset` to render given
 * values without fetching (used by the admin editor's live preview).
 * Host customisations still go into the "Custom Rules" / "Custom Restrictions" fields.
 */
import { useQuery } from '@tanstack/react-query';
import { getStandardRuleset, type StandardRuleset } from '@/lib/api.js';

export const STANDARD_RULESET: StandardRuleset = {
  settings: ['Default Funds', 'Ultra Unit Scale', '1500 Tickets', 'Unit Caps On'],
  banned: ['Masque of Slaanesh', 'Dreadmaw'],
  conduct: [
    '10 minutes to ready up',
    '40 minute round limit',
    'Exploiting bugs or glitches is considered cheating and results in disqualification.',
  ],
};

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

export function StandardRulesetCard({
  compact = false,
  ruleset,
}: {
  compact?: boolean;
  ruleset?: StandardRuleset;
}) {
  // Skip the fetch when explicit values are supplied (editor preview).
  const { data } = useQuery({
    queryKey: ['standard-ruleset'],
    queryFn: getStandardRuleset,
    staleTime: 5 * 60 * 1000,
    enabled: !ruleset,
  });
  const rs = ruleset ?? data ?? STANDARD_RULESET;

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
        <Row label="Settings" items={rs.settings} />
        <Row label="Banned" items={rs.banned} />
        <Row label="Conduct" items={rs.conduct} />
      </div>
    </div>
  );
}
