import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { getAdminConfig, putAdminConfig } from '@/lib/api.js';

interface TournamentDefaults {
  rounds_count: number;
  playoff_format: 'NONE' | 'TOP2' | 'TOP4' | 'TOP8';
  swiss_match_format: 'BO1';
  playoff_match_format: 'BO1'; // Bo3/Bo5 re-enable with series support
  finale_match_format: 'BO1';
  map_decision_mode: 'RANDOM' | 'PICK_BAN' | 'RANDOM_NO_REPEAT' | 'HOST_PRESET' | 'HOST_PRESET_PICK_BAN' | 'RANDOM_PICK_BAN';
}

const CONFIG_KEY = 'default_tournament_settings';

const DEFAULT_DEFAULTS: TournamentDefaults = {
  rounds_count: 4,
  playoff_format: 'TOP4',
  swiss_match_format: 'BO1',
  playoff_match_format: 'BO1',
  finale_match_format: 'BO1',
  map_decision_mode: 'RANDOM_PICK_BAN',
};

export function TournamentDefaultsEditor() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-config', CONFIG_KEY],
    queryFn: () => getAdminConfig(CONFIG_KEY),
    retry: false,
  });

  const [form, setForm] = useState<TournamentDefaults>(DEFAULT_DEFAULTS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data?.value && typeof data.value === 'object' && data.value !== null) {
      setForm({ ...DEFAULT_DEFAULTS, ...(data.value as Partial<TournamentDefaults>) });
    }
  }, [data]);

  const { mutate, isPending, error: saveError } = useMutation({
    mutationFn: () => putAdminConfig(CONFIG_KEY, form),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  function set<K extends keyof TournamentDefaults>(key: K, val: TournamentDefaults[K]) {
    setForm((prev) => ({ ...prev, [key]: val }));
    setSaved(false);
  }

  return (
    <div>
      <h3 className="font-display text-base font-semibold text-rizzotto-gold-400 mb-4">
        Tournament Defaults
      </h3>

      {isLoading && (
        <div className="py-4 text-center text-stone-400 text-sm">Loading…</div>
      )}

      {error && (
        <div className="rounded border border-amber-900 bg-amber-950/40 p-3 text-amber-300 text-xs mb-4">
          Config not found — showing defaults. Save to create.
        </div>
      )}

      {!isLoading && (
        <div className="space-y-4 max-w-lg">
          {/* Rounds Count */}
          <div>
            <label className="block text-xs text-stone-400 mb-1">Default Rounds Count</label>
            <input
              type="number"
              min={3}
              max={6}
              value={form.rounds_count}
              onChange={(e) => set('rounds_count', parseInt(e.target.value, 10))}
              className="w-full rounded border border-stone-700 bg-stone-900 px-3 py-1.5 text-sm text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none"
            />
            <p className="mt-0.5 text-[10px] text-stone-600">Range: 3–6</p>
          </div>

          {/* Dropdowns */}
          {(
            [
              {
                key: 'playoff_format' as const,
                label: 'Playoff Format',
                options: ['NONE', 'TOP2', 'TOP4', 'TOP8'] as const,
              },
              {
                key: 'swiss_match_format' as const,
                label: 'Swiss Match Format',
                options: ['BO1'] as const,
              },
              {
                key: 'playoff_match_format' as const,
                label: 'Playoff Match Format',
                options: ['BO1'] as const,
              },
              {
                key: 'finale_match_format' as const,
                label: 'Finale Match Format',
                options: ['BO1'] as const,
              },
              {
                key: 'map_decision_mode' as const,
                label: 'Map Decision Mode',
                options: ['RANDOM_NO_REPEAT', 'HOST_PRESET', 'HOST_PRESET_PICK_BAN', 'RANDOM_PICK_BAN', 'RANDOM', 'PICK_BAN'] as const,
              },
            ] as const
          ).map(({ key, label, options }) => (
            <div key={key}>
              <label className="block text-xs text-stone-400 mb-1">{label}</label>
              <select
                value={form[key]}
                onChange={(e) => set(key, e.target.value as TournamentDefaults[typeof key])}
                className="w-full rounded border border-stone-700 bg-stone-900 px-3 py-1.5 text-sm text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none"
              >
                {options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
          ))}

          {saveError && (
            <p className="text-xs text-red-400">{(saveError as Error).message}</p>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => mutate()}
              disabled={isPending}
              className="rounded border border-rizzotto-gold-700 bg-rizzotto-gold-500/10 px-4 py-1.5 text-sm text-rizzotto-gold-400 hover:bg-rizzotto-gold-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {isPending ? 'Saving…' : 'Save'}
            </button>
            {saved && (
              <span className="text-xs text-emerald-400">Saved.</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
