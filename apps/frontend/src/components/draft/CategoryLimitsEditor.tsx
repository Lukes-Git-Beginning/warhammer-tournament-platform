import { useQuery } from '@tanstack/react-query';
import type { CategoryLimit } from '@rizzotto/types';
import type { FactionListResponse } from '@/lib/api';
import { getFactions } from '@/lib/api';
import { FactionBadge } from '@/components/meta/FactionBadge';

export interface CategoryLimitsEditorProps {
  limits: CategoryLimit[];
  onChange: (limits: CategoryLimit[]) => void;
}

export function CategoryLimitsEditor({ limits, onChange }: CategoryLimitsEditorProps) {
  const { data: factionData } = useQuery<FactionListResponse>({
    queryKey: ['factions'],
    queryFn: () => getFactions(),
  });

  const allFactions = factionData?.data ?? [];

  function addLimit() {
    onChange([...limits, { category_name: '', factions: [], max_picks: null, max_bans: null }]);
  }

  function updateLimit(index: number, patch: Partial<CategoryLimit>) {
    onChange(limits.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function removeLimit(index: number) {
    onChange(limits.filter((_, i) => i !== index));
  }

  function toggleFaction(limitIndex: number, factionId: string) {
    const limit = limits[limitIndex];
    if (!limit) return;
    const newFactions = limit.factions.includes(factionId)
      ? limit.factions.filter((f) => f !== factionId)
      : [...limit.factions, factionId];
    updateLimit(limitIndex, { factions: newFactions });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-stone-300">Kategorie-Limits</h3>
        <button
          type="button"
          onClick={addLimit}
          className="text-xs rounded border border-stone-600 px-2.5 py-1 text-stone-300 hover:border-stone-400 hover:text-stone-100 transition-colors"
        >
          + New Limit
        </button>
      </div>

      {limits.length === 0 && (
        <p className="text-xs text-stone-500 italic">
          No category limits defined — all factions available under &quot;default&quot;.
        </p>
      )}

      {limits.map((limit, i) => (
        <div key={i} className="rounded-md border border-stone-700 bg-stone-900/60 p-3 space-y-3">
          {/* Header row */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 flex gap-2">
              {/* Name */}
              <input
                type="text"
                placeholder="Category name"
                value={limit.category_name}
                onChange={(e) => updateLimit(i, { category_name: e.target.value })}
                className="flex-1 rounded border border-stone-700 bg-stone-800 px-2 py-1.5 text-sm text-stone-200 placeholder-stone-500 focus:border-rizzotto-gold-500 focus:outline-none"
              />
              {/* max_picks */}
              <div className="flex flex-col gap-0.5">
                <label className="text-[10px] text-stone-500">Max Picks</label>
                <input
                  type="number"
                  min={0}
                  value={limit.max_picks ?? ''}
                  placeholder="∞"
                  onChange={(e) =>
                    updateLimit(i, {
                      max_picks: e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                  className="w-20 rounded border border-stone-700 bg-stone-800 px-2 py-1.5 text-sm text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none"
                />
              </div>
              {/* max_bans */}
              <div className="flex flex-col gap-0.5">
                <label className="text-[10px] text-stone-500">Max Bans</label>
                <input
                  type="number"
                  min={0}
                  value={limit.max_bans ?? ''}
                  placeholder="∞"
                  onChange={(e) =>
                    updateLimit(i, {
                      max_bans: e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                  className="w-20 rounded border border-stone-700 bg-stone-800 px-2 py-1.5 text-sm text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={() => removeLimit(i)}
              className="text-xs text-red-500 hover:text-red-400 transition-colors shrink-0"
            >
              Remove
            </button>
          </div>

          {/* Faction picker */}
          <div>
            <p className="text-[11px] text-stone-500 mb-2">
              Factions ({limit.factions.length} selected)
            </p>
            {allFactions.length === 0 ? (
              <p className="text-xs text-stone-600 italic">Loading factions…</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {allFactions.map(({ faction }) => {
                  const selected = limit.factions.includes(faction.id);
                  return (
                    <button
                      type="button"
                      key={faction.id}
                      onClick={() => toggleFaction(i, faction.id)}
                      title={faction.name}
                      className={`rounded-full transition-all ${
                        selected
                          ? 'ring-2 ring-rizzotto-gold-500 ring-offset-1 ring-offset-stone-900'
                          : 'opacity-40 hover:opacity-70'
                      }`}
                    >
                      <FactionBadge
                        colorHex={faction.color_hex}
                        initials={faction.initials}
                        name={faction.name}
                        size="sm"
                        iconUrl={faction.icon_url}
                      />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
