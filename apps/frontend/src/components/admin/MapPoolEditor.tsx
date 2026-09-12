import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAdminMaps,
  createAdminMap,
  updateAdminMap,
  deleteAdminMap,
  restoreAdminMap,
  uploadAdminMapImage,
  type MapDto,
  type BattleType,
} from '@/lib/api.js';

const BATTLE_TYPES: BattleType[] = ['DOMINATION', 'CONQUEST', 'SIEGE'];
const BATTLE_TYPE_LABELS: Record<BattleType, string> = {
  DOMINATION: 'Domination',
  CONQUEST: 'Conquest',
  SIEGE: 'Siege',
};

/** Single battle-type select — a map is built for exactly one type. */
function BattleTypeSelect({ value, onChange }: { value: BattleType; onChange: (bt: BattleType) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as BattleType)}
      className="rounded border border-stone-700 bg-stone-900 px-2 py-1 text-xs text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none"
    >
      {BATTLE_TYPES.map((bt) => (
        <option key={bt} value={bt}>
          {BATTLE_TYPE_LABELS[bt]}
        </option>
      ))}
    </select>
  );
}

interface AddMapModalProps {
  onClose: () => void;
  onCreated: () => void;
}

function AddMapModal({ onClose, onCreated }: AddMapModalProps) {
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [battleType, setBattleType] = useState<BattleType>('DOMINATION');
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { mutate, isPending } = useMutation({
    mutationFn: () =>
      createAdminMap({ slug, name, description: description || undefined, battle_type: battleType, available }),
    onSuccess: () => { onCreated(); onClose(); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-full max-w-md rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-950 p-6 shadow-xl">
        <h3 className="font-display text-lg font-semibold text-rizzotto-gold-500 mb-4">Add Map</h3>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-stone-400 mb-1">Slug (unique, lowercase)</label>
            <input
              className="w-full rounded border border-stone-700 bg-stone-900 px-3 py-1.5 text-sm text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="e.g. blood-river-crossing"
            />
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1">Name</label>
            <input
              className="w-full rounded border border-stone-700 bg-stone-900 px-3 py-1.5 text-sm text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Blood River Crossing"
            />
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1">Description (optional)</label>
            <textarea
              rows={2}
              className="w-full rounded border border-stone-700 bg-stone-900 px-3 py-1.5 text-sm text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none resize-none"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-4">
            <div>
              <label className="block text-xs text-stone-400 mb-1">Battle type</label>
              <BattleTypeSelect value={battleType} onChange={setBattleType} />
            </div>
            <label className="flex items-center gap-2 text-xs text-stone-300 pt-4">
              <input type="checkbox" checked={available} onChange={(e) => setAvailable(e.target.checked)} />
              Available for hosts + Open Play
            </label>
          </div>
        </div>

        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-stone-700 px-4 py-1.5 text-sm text-stone-400 hover:text-stone-200 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => mutate()}
            disabled={isPending || !slug || !name}
            className="rounded border border-rizzotto-gold-700 bg-rizzotto-gold-500/10 px-4 py-1.5 text-sm text-rizzotto-gold-400 hover:bg-rizzotto-gold-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isPending ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface InlineEditProps {
  value: string;
  onSave: (val: string) => void;
  placeholder?: string;
  multiline?: boolean;
}

function InlineEdit({ value, onSave, placeholder, multiline }: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => { setDraft(value); setEditing(true); }}
        className="text-left text-stone-200 hover:text-rizzotto-gold-400 transition-colors cursor-text"
        title="Click to edit"
      >
        {value || <span className="text-stone-600 italic">{placeholder ?? 'empty'}</span>}
      </button>
    );
  }

  function commit() {
    if (draft !== value) onSave(draft);
    setEditing(false);
  }

  if (multiline) {
    return (
      <textarea
        rows={2}
        className="w-full rounded border border-rizzotto-gold-700 bg-stone-900 px-2 py-1 text-sm text-stone-200 focus:outline-none resize-none"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        autoFocus
      />
    );
  }

  return (
    <input
      className="w-full rounded border border-rizzotto-gold-700 bg-stone-900 px-2 py-1 text-sm text-stone-200 focus:outline-none"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
      autoFocus
    />
  );
}

type TypeFilter = 'ALL' | BattleType;
type StatusFilter = 'ALL' | 'AVAILABLE' | 'UNAVAILABLE';

export function MapPoolEditor() {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [collapsed, setCollapsed] = useState(true);

  const { data, isLoading, error } = useQuery({ queryKey: ['admin-maps'], queryFn: getAdminMaps });

  const maps = data?.data ?? [];
  const live = maps.filter((m) => !m.deleted_at);
  const deleted = maps.filter((m) => m.deleted_at);
  const filtered = live.filter(
    (m) =>
      (typeFilter === 'ALL' || m.battle_type === typeFilter) &&
      (statusFilter === 'ALL' ||
        (statusFilter === 'AVAILABLE' ? m.available !== false : m.available === false)),
  );

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-maps'] });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { name?: string; description?: string; battle_type?: BattleType; available?: boolean } }) =>
      updateAdminMap(id, body),
    onSuccess: invalidate,
  });
  const deleteMutation = useMutation({ mutationFn: (id: string) => deleteAdminMap(id), onSuccess: invalidate });
  const restoreMutation = useMutation({ mutationFn: (id: string) => restoreAdminMap(id), onSuccess: invalidate });

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !uploadingFor) return;
    void uploadAdminMapImage(uploadingFor, file).then(invalidate);
    e.target.value = '';
    setUploadingFor(null);
  }

  if (isLoading) return <div className="py-8 text-center text-stone-400 text-sm">Loading…</div>;
  if (error) {
    return <div className="rounded border border-red-900 bg-red-950/40 p-3 text-red-300 text-xs">Failed to load maps.</div>;
  }

  function MapTable({ rows, showControls }: { rows: MapDto[]; showControls: boolean }) {
    return (
      <div className="overflow-x-auto rounded-md border border-stone-800">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="border-b border-stone-800 bg-stone-900/60">
              <th className="px-3 py-2 text-left text-stone-400 w-12">Image</th>
              <th className="px-3 py-2 text-left text-stone-400 w-32">Slug</th>
              <th className="px-3 py-2 text-left text-stone-400">Name</th>
              <th className="px-3 py-2 text-left text-stone-400 hidden sm:table-cell">Description</th>
              <th className="px-3 py-2 text-left text-stone-400">Type</th>
              <th className="px-3 py-2 text-center text-stone-400 w-24">Available</th>
              <th className="px-3 py-2 text-right text-stone-400 w-20">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-800/60">
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-stone-500">None.</td>
              </tr>
            )}
            {rows.map((m) => (
              <tr key={m.id} className="hover:bg-stone-800/20 transition-colors">
                <td className="px-3 py-2">
                  <div className="relative group">
                    {m.image_url ? (
                      <img src={m.image_url} alt={m.name} className="h-9 w-14 object-cover rounded border border-stone-700" />
                    ) : (
                      <div className="h-9 w-14 rounded border border-stone-700 bg-stone-800 flex items-center justify-center text-[10px] text-stone-600">
                        No img
                      </div>
                    )}
                    {showControls && (
                      <button
                        type="button"
                        onClick={() => { setUploadingFor(m.id); fileInputRef.current?.click(); }}
                        className="absolute inset-0 flex items-center justify-center rounded bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-stone-200"
                      >
                        Upload
                      </button>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 text-stone-500 font-mono">{m.slug}</td>
                <td className="px-3 py-2">
                  {showControls ? (
                    <InlineEdit value={m.name} onSave={(name) => updateMutation.mutate({ id: m.id, body: { name } })} />
                  ) : (
                    <span className="text-stone-500 line-through">{m.name}</span>
                  )}
                </td>
                <td className="px-3 py-2 hidden sm:table-cell">
                  {showControls ? (
                    <InlineEdit
                      value={m.description ?? ''}
                      onSave={(description) => updateMutation.mutate({ id: m.id, body: { description } })}
                      placeholder="no description"
                      multiline
                    />
                  ) : (
                    <span className="text-stone-600 text-xs">{m.description ?? '—'}</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {showControls ? (
                    <BattleTypeSelect
                      value={m.battle_type}
                      onChange={(battle_type) => updateMutation.mutate({ id: m.id, body: { battle_type } })}
                    />
                  ) : (
                    <span className="text-stone-600">{BATTLE_TYPE_LABELS[m.battle_type]}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-center">
                  {showControls ? (
                    <input
                      type="checkbox"
                      checked={m.available !== false}
                      onChange={(e) => updateMutation.mutate({ id: m.id, body: { available: e.target.checked } })}
                      title="Available for hosts + Open Play"
                      className="cursor-pointer"
                    />
                  ) : (
                    <span className="text-stone-600">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {showControls ? (
                    <button
                      type="button"
                      onClick={() => { if (confirm(`Delete map "${m.name}"?`)) deleteMutation.mutate(m.id); }}
                      className="rounded px-2 py-0.5 border border-red-800 text-red-400 hover:bg-red-900/30 transition-colors"
                      title="Soft-delete map"
                    >
                      ✕
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => restoreMutation.mutate(m.id)}
                      disabled={restoreMutation.isPending}
                      className="rounded px-2 py-0.5 border border-stone-600 text-stone-400 hover:bg-stone-700/40 hover:text-stone-200 disabled:opacity-40 transition-colors"
                      title="Restore map"
                    >
                      Restore
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const availableCount = live.filter((m) => m.available !== false).length;

  return (
    <div>
      {/* Collapsible header — the map pool is long, so keep it folded by default. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-2 font-display text-base font-semibold text-rizzotto-gold-400 hover:text-rizzotto-gold-300 transition-colors"
        >
          <span className="text-xs text-rizzotto-stone-500">{collapsed ? '▸' : '▾'}</span>
          Map Pool ({availableCount} available / {live.length} total)
        </button>
        {!collapsed && (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="rounded border border-rizzotto-gold-700 bg-rizzotto-gold-500/10 px-3 py-1.5 text-xs text-rizzotto-gold-400 hover:bg-rizzotto-gold-500/20 transition-colors"
          >
            + Add Map
          </button>
        )}
      </div>

      {collapsed ? null : (
      <div className="mt-4">
      {/* Filters — by battle type and by availability */}
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs">
        <label className="flex items-center gap-2">
          <span className="text-stone-500">Type</span>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
            className="rounded border border-stone-700 bg-stone-900 px-2 py-1 text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none"
          >
            <option value="ALL">All</option>
            {BATTLE_TYPES.map((bt) => (
              <option key={bt} value={bt}>{BATTLE_TYPE_LABELS[bt]}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-stone-500">Status</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="rounded border border-stone-700 bg-stone-900 px-2 py-1 text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none"
          >
            <option value="ALL">All</option>
            <option value="AVAILABLE">Available</option>
            <option value="UNAVAILABLE">Unavailable</option>
          </select>
        </label>
        <span className="text-stone-600">{filtered.length} shown</span>
      </div>

      <MapTable rows={filtered} showControls />

      {deleted.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-stone-500 hover:text-stone-300 select-none">
            Show {deleted.length} soft-deleted map(s)
          </summary>
          <div className="mt-2">
            <MapTable rows={deleted} showControls={false} />
          </div>
        </details>
      )}
      </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={handleImageUpload}
      />

      {showAdd && <AddMapModal onClose={() => setShowAdd(false)} onCreated={invalidate} />}
    </div>
  );
}
