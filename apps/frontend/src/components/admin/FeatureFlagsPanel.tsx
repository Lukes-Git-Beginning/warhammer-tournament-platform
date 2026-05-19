import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAdminConfig, putAdminConfig } from '@/lib/api.js';

const CONFIG_KEY = 'feature_flags';

interface FeatureFlags {
  arena: boolean;
  slt: boolean;
  bpt: boolean;
  sft: boolean;
  [key: string]: boolean;
}

const FLAG_LABELS: Record<string, string> = {
  arena: 'Arena Mode',
  slt: 'SLT (Swiss League Tournament)',
  bpt: 'BPT (Bracket Points Tournament)',
  sft: 'SFT (Swiss Finals Tournament)',
};

const DEFAULT_FLAGS: FeatureFlags = {
  arena: false,
  slt: false,
  bpt: false,
  sft: false,
};

function Toggle({
  checked,
  onChange,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  id: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-rizzotto-gold-500 ${
        checked
          ? 'bg-rizzotto-gold-500/60 border-rizzotto-gold-600'
          : 'bg-stone-700 border-stone-600'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

export function FeatureFlagsPanel() {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-config', CONFIG_KEY],
    queryFn: () => getAdminConfig(CONFIG_KEY),
    retry: false,
  });

  const [flags, setFlags] = useState<FeatureFlags>(DEFAULT_FLAGS);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  useEffect(() => {
    if (data?.value && typeof data.value === 'object' && data.value !== null) {
      const merged: FeatureFlags = { ...DEFAULT_FLAGS };
      const raw = data.value as Record<string, unknown>;
      for (const key of Object.keys(raw)) {
        if (typeof raw[key] === 'boolean') {
          merged[key] = raw[key] as boolean;
        }
      }
      setFlags(merged);
    }
  }, [data]);

  const { mutate } = useMutation({
    mutationFn: (newFlags: FeatureFlags) => putAdminConfig(CONFIG_KEY, newFlags),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-config', CONFIG_KEY] });
      setPendingKey(null);
      setLastSaved(new Date().toLocaleTimeString());
    },
    onError: () => setPendingKey(null),
  });

  function toggle(key: string) {
    const updated: FeatureFlags = { ...flags, [key]: !(flags[key] ?? false) };
    setFlags(updated);
    setPendingKey(key);
    mutate(updated);
  }

  // Collect all known flag keys (DEFAULT_FLAGS + any extra from backend)
  const allKeys = Array.from(new Set([...Object.keys(DEFAULT_FLAGS), ...Object.keys(flags)]));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-display text-base font-semibold text-rizzotto-gold-400">
          Feature Flags
        </h3>
        {lastSaved && (
          <span className="text-xs text-stone-500">Last saved: {lastSaved}</span>
        )}
      </div>

      {isLoading && (
        <div className="py-4 text-center text-stone-400 text-sm">Loading…</div>
      )}

      {error && (
        <div className="rounded border border-amber-900 bg-amber-950/40 p-3 text-amber-300 text-xs mb-4">
          Config not found — all flags default to OFF. Toggle to create.
        </div>
      )}

      {!isLoading && (
        <div className="space-y-3 max-w-sm">
          {allKeys.map((key) => (
            <div key={key} className="flex items-center justify-between">
              <label
                htmlFor={`flag-${key}`}
                className="flex flex-col cursor-pointer select-none"
              >
                <span className="text-sm text-stone-200">
                  {FLAG_LABELS[key] ?? key.toUpperCase()}
                </span>
                <span className="text-[10px] text-stone-600 font-mono">{key}</span>
              </label>
              <div className="flex items-center gap-2">
                {pendingKey === key && (
                  <span className="text-[10px] text-stone-500">saving…</span>
                )}
                <Toggle
                  id={`flag-${key}`}
                  checked={flags[key] ?? false}
                  onChange={() => toggle(key)}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
