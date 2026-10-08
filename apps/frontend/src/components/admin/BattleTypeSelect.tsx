import type { SkillScope } from '@/lib/api.js';

const OPTIONS: { value: SkillScope; label: string }[] = [
  { value: 'OVERALL', label: 'Overall' },
  { value: 'DOMINATION', label: 'Domination' },
  { value: 'CONQUEST', label: 'Conquest' },
  { value: 'SIEGE', label: 'Siege' },
];

/** Admin picker for which battle type a skill band is judged in (Overall = game-weighted summary). */
export function BattleTypeSelect({
  value,
  onChange,
  label = 'Skill in',
}: {
  value: SkillScope;
  onChange: (scope: SkillScope) => void;
  label?: string;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-stone-500">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SkillScope)}
        aria-label="Battle type"
        className="rounded border border-stone-700 bg-stone-900 px-2 py-1 text-xs text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none"
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Parse a deep-linked battle type, falling back to Overall. */
export function parseScope(raw: string | undefined): SkillScope {
  return raw === 'DOMINATION' || raw === 'CONQUEST' || raw === 'SIEGE' ? raw : 'OVERALL';
}
