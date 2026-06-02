import { useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CreateDraftPresetSchema } from '@rizzotto/types';
import type {
  DraftPreset,
  DraftTurn,
  CategoryLimit,
  CreateDraftPresetRequest,
} from '@rizzotto/types';
import { TurnEditor } from './TurnEditor';
import { CategoryLimitsEditor } from './CategoryLimitsEditor';
import { DraftSequenceTimeline } from './DraftSequenceTimeline';

interface PresetEditorProps {
  initialPreset?: DraftPreset;
  onSave: (input: CreateDraftPresetRequest) => Promise<void>;
}

function makeTurn(actor: DraftTurn['actor'], order: number): DraftTurn {
  return {
    order,
    actor,
    action: actor === 'admin' ? 'reveal_all' : 'pick',
    variant: actor === 'admin' ? null : 'global',
    is_hidden: false,
    is_parallel: false,
    as_opponent: false,
    category: 'default',
  };
}

interface SortableTurnProps {
  id: string;
  turn: DraftTurn;
  index: number;
  categoryNames: string[];
  onChange: (turn: DraftTurn) => void;
  onDelete: () => void;
}

function SortableTurnItem({
  id,
  turn,
  index,
  categoryNames,
  onChange,
  onDelete,
}: SortableTurnProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <TurnEditor
        turn={turn}
        index={index}
        categoryNames={categoryNames}
        onChange={onChange}
        onDelete={onDelete}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}

export function PresetEditor({ initialPreset, onSave }: PresetEditorProps) {
  const [name, setName] = useState(initialPreset?.name ?? '');
  const [description, setDescription] = useState(initialPreset?.description ?? '');
  const [isPublic, setIsPublic] = useState(initialPreset?.is_public ?? false);
  const [turnSeconds, setTurnSeconds] = useState(initialPreset?.turn_seconds ?? 30);
  const [turns, setTurns] = useState<DraftTurn[]>(initialPreset?.turns ?? []);
  const [categoryLimits, setCategoryLimits] = useState<CategoryLimit[]>(
    initialPreset?.category_limits ?? [],
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Category names derived from limits + always "default"
  const categoryNames = ['default', ...categoryLimits.map((l) => l.category_name).filter(Boolean)];

  function addTurn(actor: DraftTurn['actor']) {
    setTurns((prev) => {
      const order = prev.length + 1;
      return [...prev, makeTurn(actor, order)];
    });
  }

  function updateTurn(index: number, updated: DraftTurn) {
    setTurns((prev) => prev.map((t, i) => (i === index ? updated : t)));
  }

  function deleteTurn(index: number) {
    setTurns((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.map((t, i) => ({ ...t, order: i + 1 }));
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setTurns((prev) => {
      const oldIndex = prev.findIndex((_, i) => String(i + 1) === active.id);
      const newIndex = prev.findIndex((_, i) => String(i + 1) === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      const moved = arrayMove(prev, oldIndex, newIndex);
      return moved.map((t, i) => ({ ...t, order: i + 1 }));
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const formData = {
      name,
      description: description || undefined,
      is_public: isPublic,
      turn_seconds: turnSeconds,
      turns,
      category_limits: categoryLimits,
    };

    const result = CreateDraftPresetSchema.safeParse(formData);
    if (!result.success) {
      const first = result.error.errors[0];
      setError(first ? `${first.path.join('.')}: ${first.message}` : 'Validierungsfehler');
      return;
    }

    setSaving(true);
    try {
      await onSave(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unbekannter Fehler');
    } finally {
      setSaving(false);
    }
  }

  // Sortable item IDs: use order as string
  const sortableIds = turns.map((_, i) => String(i + 1));

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* Basic Info */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-stone-200">Grundeinstellungen</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Name */}
          <div className="flex flex-col gap-1">
            <label className="text-sm text-stone-400">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              required
              placeholder="z.B. Standard 5-Ban 3-Pick"
              className="rounded border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-stone-100 placeholder-stone-600 focus:border-rizzotto-gold-500 focus:outline-none"
            />
          </div>

          {/* Turn seconds */}
          <div className="flex flex-col gap-1">
            <label className="text-sm text-stone-400">Zeit pro Zug (Sek.)</label>
            <input
              type="number"
              value={turnSeconds}
              onChange={(e) => setTurnSeconds(Number(e.target.value))}
              min={5}
              max={600}
              className="rounded border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-stone-100 focus:border-rizzotto-gold-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Description */}
        <div className="flex flex-col gap-1">
          <label className="text-sm text-stone-400">Beschreibung</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
            rows={3}
            placeholder="Optional — Kurzbeschreibung des Preset-Formats"
            className="rounded border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-stone-100 placeholder-stone-600 focus:border-rizzotto-gold-500 focus:outline-none resize-none"
          />
        </div>

        {/* is_public */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
            className="rounded border-stone-600 bg-stone-800 accent-rizzotto-gold-500"
          />
          <span className="text-sm text-stone-300">Öffentlich sichtbar</span>
        </label>
      </section>

      {/* Category Limits */}
      <section>
        <CategoryLimitsEditor limits={categoryLimits} onChange={setCategoryLimits} />
      </section>

      {/* Sequence Timeline */}
      {turns.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-stone-200">Sequenz-Vorschau</h2>
          <DraftSequenceTimeline turns={turns} />
        </section>
      )}

      {/* Turn list with DnD */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-stone-200">Züge ({turns.length})</h2>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => addTurn('host')}
              className="text-xs rounded border border-blue-700 px-2.5 py-1 text-blue-300 hover:border-blue-500 hover:text-blue-100 transition-colors"
            >
              + Host-Zug
            </button>
            <button
              type="button"
              onClick={() => addTurn('guest')}
              className="text-xs rounded border border-red-800 px-2.5 py-1 text-red-300 hover:border-red-600 hover:text-red-100 transition-colors"
            >
              + Guest-Zug
            </button>
            <button
              type="button"
              onClick={() => addTurn('admin')}
              className="text-xs rounded border border-stone-600 px-2.5 py-1 text-stone-300 hover:border-stone-400 hover:text-stone-100 transition-colors"
            >
              + Admin-Reveal-Zug
            </button>
          </div>
        </div>

        {turns.length === 0 && (
          <div className="rounded-md border border-stone-800 bg-stone-900/40 p-8 text-center text-stone-500 text-sm">
            Noch keine Züge — füge Host-, Guest- oder Admin-Züge hinzu.
          </div>
        )}

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {turns.map((turn, i) => (
                <SortableTurnItem
                  key={sortableIds[i]}
                  id={sortableIds[i]!}
                  turn={turn}
                  index={i}
                  categoryNames={categoryNames}
                  onChange={(updated) => updateTurn(i, updated)}
                  onDelete={() => deleteTurn(i)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </section>

      {/* Error */}
      {error && (
        <div className="rounded-md border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Submit */}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="rounded border border-rizzotto-gold-500/60 bg-rizzotto-gold-500/10 px-6 py-2 text-sm font-medium text-rizzotto-gold-500 hover:bg-rizzotto-gold-500/20 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Speichern…' : 'Preset speichern'}
        </button>
      </div>
    </form>
  );
}
