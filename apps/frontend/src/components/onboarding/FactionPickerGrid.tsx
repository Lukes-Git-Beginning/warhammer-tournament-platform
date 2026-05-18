import { useQuery } from '@tanstack/react-query';
import { getFactions } from '@/lib/api';
import { Skeleton } from '@/components/ui/skeleton';
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
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-sm" />
        ))}
      </div>
    );
  }

  const factions = [...data.data]
    .map((row) => row.faction)
    .sort((a, b) => a.display_order - b.display_order);

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
      <div className="grid max-h-[36vh] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3 lg:grid-cols-4">
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
                'group relative flex h-12 items-center gap-2 rounded-sm border border-rizzotto-iron-600 bg-rizzotto-iron-900 px-3 text-left transition-[border-color,background-color,color] duration-base ease-burn',
                'hover:border-rizzotto-gold-500/60 hover:bg-rizzotto-iron-800',
                active && 'border-rizzotto-gold-500 bg-rizzotto-iron-800 text-rizzotto-gold-300',
                disabled && 'cursor-not-allowed opacity-40 hover:border-rizzotto-iron-600 hover:bg-rizzotto-iron-900',
              )}
            >
              <span
                aria-hidden="true"
                className="h-6 w-1 shrink-0 rounded-sm"
                style={{ backgroundColor: f.color_hex }}
              />
              <span className="truncate font-display text-[12px] uppercase tracking-wide">
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
