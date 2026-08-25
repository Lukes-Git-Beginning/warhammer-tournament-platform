import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAdminConfig, putAdminConfig, type StandardRuleset } from '@/lib/api.js';
import { StandardRulesetCard, STANDARD_RULESET } from '@/components/tournament/StandardRulesetCard.js';

const CONFIG_KEY = 'standard_ruleset';

const linesToArray = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);
const arrayToLines = (a: string[]) => a.join('\n');

function Field({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
}) {
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
    queryKey: ['admin-config', CONFIG_KEY],
    queryFn: () => getAdminConfig(CONFIG_KEY),
    retry: false,
  });

  const [settings, setSettings] = useState(arrayToLines(STANDARD_RULESET.settings));
  const [banned, setBanned] = useState(arrayToLines(STANDARD_RULESET.banned));
  const [conduct, setConduct] = useState(arrayToLines(STANDARD_RULESET.conduct));
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const v = data?.value as Partial<StandardRuleset> | undefined;
    if (v && Array.isArray(v.settings) && Array.isArray(v.banned) && Array.isArray(v.conduct)) {
      setSettings(arrayToLines(v.settings));
      setBanned(arrayToLines(v.banned));
      setConduct(arrayToLines(v.conduct));
    }
  }, [data]);

  const preview: StandardRuleset = {
    settings: linesToArray(settings),
    banned: linesToArray(banned),
    conduct: linesToArray(conduct),
  };

  const { mutate, isPending, error: saveError } = useMutation({
    mutationFn: () => putAdminConfig(CONFIG_KEY, preview),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      // Refresh the live card everywhere it is shown.
      void queryClient.invalidateQueries({ queryKey: ['standard-ruleset'] });
    },
  });

  const onChange = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setSaved(false);
  };

  return (
    <div>
      <h3 className="mb-1 font-display text-base font-semibold text-rizzotto-gold-400">Standard Ruleset</h3>
      <p className="mb-4 text-xs text-stone-500">
        The community Standard Ruleset shown on tournaments (when enabled), the queue, and challenges. One entry per
        line.
      </p>

      {isLoading && <div className="py-4 text-center text-sm text-stone-400">Loading…</div>}

      {!isLoading && (
        <div className="flex flex-col gap-6 lg:flex-row">
          <div className="flex flex-1 flex-col gap-4">
            <Field label="Settings" hint="Game settings (e.g. 1500 Tickets)" value={settings} onChange={onChange(setSettings)} />
            <Field label="Banned Units" hint="Units banned from play" value={banned} onChange={onChange(setBanned)} />
            <Field label="Conduct" hint="Timing + conduct rules" value={conduct} onChange={onChange(setConduct)} />
          </div>

          <div className="flex-1">
            <p className="mb-1 text-xs text-stone-500">Live preview</p>
            <StandardRulesetCard ruleset={preview} />
          </div>
        </div>
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
            {isPending ? 'Saving…' : 'Save'}
          </button>
          {saved && <span className="text-xs text-emerald-400">Saved.</span>}
        </div>
      )}
    </div>
  );
}
