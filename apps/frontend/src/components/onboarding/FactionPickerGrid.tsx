import { useQuery } from '@tanstack/react-query';
import { getFactions } from '@/lib/api';
import { Skeleton } from '@/components/ui/skeleton';
import { FactionBadge } from '@/components/meta/FactionBadge';
import { cn } from '@/lib/utils';

interface FactionPickerGridProps {
  selected: string[];
  onChange: (next: string[]) => void;
  maxSelections?: number;
}

export function FactionPickerGrid({
  selected,
  onChange,
  maxSelections = 5,
}: FactionPickerGridProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['factions'],
    queryFn: () => getFactions(),
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-sm" />
        ))}
      </div>
    );
  }

  const factions = [...data.data]
    .map((row) => row.faction)
    .sort((a, b) => a.name.localeCompare(b.name));

  function toggle(id: string) {
    if (selected.includes(id)) {
      onChange(selected.filter((x) => x !== id));
      return;
    }
    if (selected.length >= maxSelections) return;
    onChange([...selected, id]);
  }

  return (
    <div>
      <div className="grid max-h-[52vh] grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4 lg:grid-cols-6">
        {factions.map((f) => {
          const active = selected.includes(f.id);
          const disabled = !active && selected.length >= maxSelections;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => toggle(f.id)}
              disabled={disabled}
              data-selected={active}
              className={cn(
                'flex flex-col items-center gap-1.5 rounded-sm border p-2 text-center transition-[border-color,background-color,color] duration-base ease-burn',
                'border-rizzotto-iron-600 bg-rizzotto-iron-900',
                'hover:border-rizzotto-gold-500/60 hover:bg-rizzotto-iron-800',
                active && 'border-rizzotto-gold-500 bg-rizzotto-iron-800',
                disabled && 'cursor-not-allowed opacity-40 hover:border-rizzotto-iron-600 hover:bg-rizzotto-iron-900',
              )}
            >
              <FactionBadge
                size="lg"
                colorHex={f.color_hex}
                initials={f.initials}
                name={f.name}
                iconUrl={f.icon_url}
              />
              <span
                className={cn(
                  'line-clamp-2 font-display text-[10px] uppercase leading-tight tracking-wide',
                  active ? 'text-rizzotto-gold-300' : 'text-rizzotto-stone-300',
                )}
              >
                {f.name}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] uppercase tracking-wider text-rizzotto-stone-400">
        {selected.length} / {maxSelections} chosen — optional
      </p>
    </div>
  );
}
