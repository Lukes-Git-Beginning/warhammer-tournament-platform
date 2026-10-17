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
import { getFactions, getRuleDocuments, getStandardRuleset, type BattleType, type StandardRuleset } from '@/lib/api.js';
import { BATTLE_TYPE_LABELS } from '@rizzotto/types';
import { battleTypeIconSrc } from '@/lib/battleTypeIcons';

const BATTLE_TYPE_LABEL: Record<string, string> = BATTLE_TYPE_LABELS;

export const STANDARD_RULESET: StandardRuleset = {
  settings: ['Default Funds', 'Ultra Unit Scale', '1500 Tickets', 'Unit Caps On'],
  banned_factions: ['undead_legions'],
  banned: ['Masque of Slaanesh', 'Dreadmaw'],
  banned_abilities: [],
  conduct: [
    '10 minutes to ready up',
    '40 minute round limit',
    'Exploiting bugs or glitches is considered cheating and results in disqualification.',
  ],
};

function Row({ label, items }: { label: string; items: readonly string[] }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:gap-3">
      <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-rizzotto-gold-500/80 sm:w-40">
        {label}
      </span>
      <span className="text-stone-300">{items.join(' · ')}</span>
    </div>
  );
}

export function StandardRulesetCard({
  compact = false,
  ruleset,
  battleType,
  competitorFormat,
}: {
  compact?: boolean;
  ruleset?: StandardRuleset;
  /** Show the ruleset for this combo (defaults to Domination / 1v1 when omitted). */
  battleType?: BattleType;
  competitorFormat?: 'ONE_V_ONE' | 'TWO_V_TWO';
}) {
  // Skip the fetch when explicit values are supplied (editor preview).
  const { data } = useQuery({
    queryKey: ['standard-ruleset', battleType ?? 'DOMINATION', competitorFormat ?? 'ONE_V_ONE'],
    queryFn: () => getStandardRuleset(battleType, competitorFormat),
    staleTime: 5 * 60 * 1000,
    enabled: !ruleset,
  });
  const rs = ruleset ?? data ?? STANDARD_RULESET;
  const icon = battleTypeIconSrc(battleType);
  // Banned factions are stored as faction ids — show their names (raw entry as a fallback).
  const { data: factionList } = useQuery({
    queryKey: ['factions'],
    queryFn: () => getFactions(),
    staleTime: 60 * 60_000,
    enabled: (rs.banned_factions?.length ?? 0) > 0,
  });
  const factionName = new Map((factionList?.data ?? []).map((d) => [d.faction.id, d.faction.name]));
  const bannedFactionNames = (rs.banned_factions ?? []).map((id) => factionName.get(id) ?? id);
  // Full rules documents for this battle type (e.g. the Fruit Rules), linked via their permalink so
  // a new document version never changes the link. Only documents the admin has pointed somewhere.
  const { data: ruleDocs } = useQuery({
    queryKey: ['rule-documents'],
    queryFn: getRuleDocuments,
    staleTime: 5 * 60 * 1000,
    enabled: !!battleType,
  });
  const fullRules = (ruleDocs?.documents ?? []).filter((d) => d.url && battleType && d.battle_types.includes(battleType));
  const title = battleType ? `Standard ${BATTLE_TYPE_LABEL[battleType] ?? battleType} Ruleset` : 'Standard Ruleset';

  return (
    <div
      className={`relative overflow-hidden rounded-md border border-stone-800 bg-stone-900/50 text-sm leading-relaxed ${
        compact ? 'p-3' : 'p-6'
      }`}
    >
      {/* Battle-type watermark at a fixed, centered size (not stretched to the card) so it
          reads at the same scale as on the tournament tiles rather than filling the larger
          rules tile. opacity matches the tournament watermark (0.12). */}
      {icon && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden" aria-hidden>
          <img src={icon} alt="" className="h-48 w-48 object-contain opacity-[0.12]" />
        </div>
      )}
      <div className="relative">
        <div className="mb-2 flex items-center gap-2">
          {icon ? (
            <img src={icon} alt="" className="h-5 w-5 shrink-0 object-contain" />
          ) : (
            <span className="text-rizzotto-gold-400">⚔️</span>
          )}
          <span className="font-display font-semibold text-rizzotto-gold-500">{title}</span>
        </div>
        <div className="space-y-1.5">
          <Row label="Settings" items={rs.settings} />
          {/* Each ban category is shown only when something in it is banned. */}
          {bannedFactionNames.length > 0 && <Row label="Banned Factions" items={bannedFactionNames} />}
          {rs.banned.length > 0 && <Row label="Banned Units" items={rs.banned} />}
          {(rs.banned_abilities?.length ?? 0) > 0 && (
            <Row label="Banned Spells / Items / Abilities" items={rs.banned_abilities!} />
          )}
          <Row label="Conduct" items={rs.conduct} />
          {fullRules.length > 0 && (
            <div className="flex flex-col gap-1 sm:flex-row sm:gap-3">
              <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-rizzotto-gold-500/80 sm:w-40">
                Full Rules
              </span>
              <span className="text-stone-300">
                {fullRules.map((d, i) => (
                  <span key={d.slug}>
                    {i > 0 && ' · '}
                    <a href={`/rules/${d.slug}`} target="_blank" rel="noopener noreferrer" className="text-rizzotto-gold-400 underline">
                      {d.label}
                    </a>
                  </span>
                ))}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
