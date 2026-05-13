import type { DraftTurn } from '@tww3/types';

export interface TurnEditorProps {
  turn: DraftTurn;
  index: number;
  categoryNames: string[];
  onChange: (turn: DraftTurn) => void;
  onDelete: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dragHandleProps?: Record<string, any>;
}

const ACTOR_OPTIONS = [
  { value: 'host', label: 'Host' },
  { value: 'guest', label: 'Guest' },
  { value: 'admin', label: 'Admin' },
] as const;

const ACTION_OPTIONS = [
  { value: 'pick', label: 'Pick' },
  { value: 'ban', label: 'Ban' },
  { value: 'snipe', label: 'Snipe' },
  { value: 'steal', label: 'Steal' },
  { value: 'reveal_picks', label: 'Reveal Picks' },
  { value: 'reveal_bans', label: 'Reveal Bans' },
  { value: 'reveal_all', label: 'Reveal All' },
] as const;

const VARIANT_OPTIONS = [
  { value: 'global', label: 'Global' },
  { value: 'exclusive', label: 'Exclusive' },
  { value: 'nonexclusive', label: 'Non-exclusive' },
] as const;

const VARIANT_ACTIONS = new Set(['pick', 'ban']);

export function TurnEditor({ turn, index, categoryNames, onChange, onDelete, dragHandleProps }: TurnEditorProps) {
  const showVariant = VARIANT_ACTIONS.has(turn.action);

  function update(patch: Partial<DraftTurn>) {
    onChange({ ...turn, ...patch });
  }

  return (
    <div className="rounded-md border border-stone-700 bg-stone-900 p-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {/* Drag handle */}
          <button
            type="button"
            {...dragHandleProps}
            className="cursor-grab text-stone-500 hover:text-stone-300 select-none px-1"
            aria-label="Reihenfolge ändern"
          >
            ⋮⋮
          </button>
          <span className="text-sm font-medium text-stone-300">Zug #{index + 1}</span>
        </div>
        <button
          type="button"
          onClick={onDelete}
          className="text-xs text-red-500 hover:text-red-400 transition-colors"
          aria-label="Zug löschen"
        >
          Löschen
        </button>
      </div>

      {/* Fields */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {/* Actor */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-stone-500">Akteur</label>
          <select
            value={turn.actor}
            onChange={(e) => update({ actor: e.target.value as DraftTurn['actor'] })}
            className="rounded border border-stone-700 bg-stone-800 px-2 py-1.5 text-sm text-stone-200 focus:border-warhammer-gold focus:outline-none"
          >
            {ACTOR_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* Action */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-stone-500">Aktion</label>
          <select
            value={turn.action}
            onChange={(e) => {
              const action = e.target.value as DraftTurn['action'];
              const variant = VARIANT_ACTIONS.has(action) ? (turn.variant ?? 'global') : null;
              update({ action, variant });
            }}
            className="rounded border border-stone-700 bg-stone-800 px-2 py-1.5 text-sm text-stone-200 focus:border-warhammer-gold focus:outline-none"
          >
            {ACTION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* Variant — only for pick/ban */}
        {showVariant && (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-stone-500">Variante</label>
            <select
              value={turn.variant ?? 'global'}
              onChange={(e) => update({ variant: e.target.value as DraftTurn['variant'] })}
              className="rounded border border-stone-700 bg-stone-800 px-2 py-1.5 text-sm text-stone-200 focus:border-warhammer-gold focus:outline-none"
            >
              {VARIANT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* Category */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-stone-500">Kategorie</label>
          <select
            value={turn.category}
            onChange={(e) => update({ category: e.target.value })}
            className="rounded border border-stone-700 bg-stone-800 px-2 py-1.5 text-sm text-stone-200 focus:border-warhammer-gold focus:outline-none"
          >
            {categoryNames.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Checkboxes */}
      <div className="flex flex-wrap gap-4 mt-3">
        <label className="flex items-center gap-1.5 text-sm text-stone-300 cursor-pointer">
          <input
            type="checkbox"
            checked={turn.is_hidden}
            onChange={(e) => update({ is_hidden: e.target.checked })}
            className="rounded border-stone-600 bg-stone-800 accent-warhammer-gold"
          />
          Versteckt
        </label>
        <label className="flex items-center gap-1.5 text-sm text-stone-300 cursor-pointer">
          <input
            type="checkbox"
            checked={turn.is_parallel}
            onChange={(e) => update({ is_parallel: e.target.checked })}
            className="rounded border-stone-600 bg-stone-800 accent-warhammer-gold"
          />
          Parallel
        </label>
        <label className="flex items-center gap-1.5 text-sm text-stone-300 cursor-pointer">
          <input
            type="checkbox"
            checked={turn.as_opponent}
            onChange={(e) => update({ as_opponent: e.target.checked })}
            className="rounded border-stone-600 bg-stone-800 accent-warhammer-gold"
          />
          Als Gegner
        </label>
      </div>
    </div>
  );
}
