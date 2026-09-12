import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAllStandardRulesets, putAdminConfig, type StandardRuleset } from '@/lib/api.js';
import { StandardRulesetCard, STANDARD_RULESET } from '@/components/tournament/StandardRulesetCard.js';

const CONFIG_KEY = 'standard_ruleset';

const BATTLE_TYPES = ['DOMINATION', 'CONQUEST', 'SIEGE'] as const;
const COMPETITOR_FORMATS = ['ONE_V_ONE', 'TWO_V_TWO'] as const;
const BT_LABEL: Record<string, string> = { DOMINATION: 'Domination', CONQUEST: 'Conquest', SIEGE: 'Siege' };
const CF_LABEL: Record<string, string> = { ONE_V_ONE: '1v1', TWO_V_TWO: '2v2' };
const comboKey = (bt: string, cf: string) => `${bt}:${cf}`;
const COMBOS = BATTLE_TYPES.flatMap((bt) =>
  COMPETITOR_FORMATS.map((cf) => ({ key: comboKey(bt, cf), label: `${BT_LABEL[bt]} · ${CF_LABEL[cf]}` })),
);

const linesToArray = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);
const arrayToLines = (a: string[]) => a.join('\n');

function Field({ label, hint, value, onChange }: { label: string; hint: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex-1">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-rizzotto-gold-500/80">{label}</p>
      <p className="mb-1 text-xs text-stone-500">{hint}</p>
      <textarea
        rows={5}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full resize-y rounded border border-stone-700 bg-stone-900 px-3 py-2 font-mono text-xs text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none"
      />
    </div>
  );
}

export function StandardRulesetEditor() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['admin-standard-rulesets'],
    queryFn: getAllStandardRulesets,
    retry: false,
  });

  // Local edit buffer for all 6 combos, plus the currently-selected combo.
  const [map, setMap] = useState<Record<string, StandardRuleset>>({});
  const [selected, setSelected] = useState<string>(COMBOS[0]!.key);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data?.rulesets) setMap(data.rulesets);
  }, [data]);

  const current = map[selected] ?? STANDARD_RULESET;
  const setField = (field: keyof StandardRuleset) => (v: string) => {
    setSaved(false);
    setMap((prev) => ({
      ...prev,
      [selected]: { ...(prev[selected] ?? STANDARD_RULESET), [field]: linesToArray(v) },
    }));
  };

  const { mutate, isPending, error: saveError } = useMutation({
    // Persist the full 6-combo map under the single config key.
    mutationFn: () => putAdminConfig(CONFIG_KEY, map),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      void queryClient.invalidateQueries({ queryKey: ['standard-ruleset'] });
    },
  });

  return (
    <div>
      <h3 className="mb-1 font-display text-base font-semibold text-rizzotto-gold-400">Standard Ruleset</h3>
      <p className="mb-3 text-xs text-stone-500">
        The community Standard Ruleset shown on tournaments (when enabled), the queue, and challenges — configured per
        battle type × team size. One entry per line. Edits to all six combos are saved together.
      </p>

      {isLoading && <div className="py-4 text-center text-sm text-stone-400">Loading…</div>}

      {!isLoading && (
        <>
          {/* Combo selector */}
          <div className="mb-4 flex flex-wrap gap-2">
            {COMBOS.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setSelected(c.key)}
                className={`rounded border px-3 py-1.5 text-sm font-medium transition-colors ${
                  selected === c.key
                    ? 'border-rizzotto-gold-400/70 bg-rizzotto-gold-500/20 text-rizzotto-gold-300'
                    : 'border-stone-700 text-stone-400 hover:border-stone-500 hover:text-stone-200'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-6 lg:flex-row">
            <div className="flex flex-1 flex-col gap-4">
              <Field label="Settings" hint="Game settings (e.g. 1500 Tickets)" value={arrayToLines(current.settings)} onChange={setField('settings')} />
              <Field label="Banned Units" hint="Units banned from play" value={arrayToLines(current.banned)} onChange={setField('banned')} />
              <Field label="Conduct" hint="Timing + conduct rules" value={arrayToLines(current.conduct)} onChange={setField('conduct')} />
            </div>

            <div className="flex-1">
              <p className="mb-1 text-xs text-stone-500">Live preview — {COMBOS.find((c) => c.key === selected)?.label}</p>
              <StandardRulesetCard ruleset={current} />
            </div>
          </div>
        </>
      )}

      {saveError && <p className="mt-2 text-xs text-red-400">{(saveError as Error).message}</p>}

      {!isLoading && (
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => mutate()}
            disabled={isPending}
            className="rounded border border-rizzotto-gold-700 bg-rizzotto-gold-500/10 px-4 py-1.5 text-sm text-rizzotto-gold-400 transition-colors hover:bg-rizzotto-gold-500/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isPending ? 'Saving…' : 'Save all combos'}
          </button>
          {saved && <span className="text-xs text-emerald-400">Saved.</span>}
        </div>
      )}
    </div>
  );
}
