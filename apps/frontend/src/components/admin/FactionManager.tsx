import { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAdminFactions,
  createAdminFaction,
  updateAdminFaction,
  uploadAdminFactionSigil,
  type AdminFactionDto,
} from '@/lib/api.js';

// ---------------------------------------------------------------------------
// Sigil Upload Modal
// ---------------------------------------------------------------------------

interface SigilUploadModalProps {
  faction: AdminFactionDto;
  onClose: () => void;
  onUploaded: () => void;
}

function SigilUploadModal({ faction, onClose, onUploaded }: SigilUploadModalProps) {
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(f: File) {
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, []);

  async function upload() {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await uploadAdminFactionSigil(faction.id, file);
      onUploaded();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-full max-w-sm rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-950 p-6 shadow-xl">
        <h3 className="font-display text-base font-semibold text-rizzotto-gold-500 mb-1">
          Upload Sigil
        </h3>
        <p className="text-xs text-stone-500 mb-4">{faction.name}</p>

        {/* Drop zone */}
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex h-40 cursor-pointer flex-col items-center justify-center rounded border-2 border-dashed transition-colors ${
            dragging
              ? 'border-rizzotto-gold-500 bg-rizzotto-gold-500/10'
              : 'border-stone-700 hover:border-stone-500'
          }`}
        >
          {preview ? (
            <img src={preview} alt="preview" className="h-32 w-32 object-contain" />
          ) : (
            <>
              <span className="text-2xl text-stone-600">🖼</span>
              <p className="mt-2 text-xs text-stone-500">
                Drag & drop PNG/JPG or click to browse
              </p>
            </>
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />

        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

        <div className="mt-4 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-stone-700 px-3 py-1.5 text-sm text-stone-400 hover:text-stone-200 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void upload()}
            disabled={!file || uploading}
            className="rounded border border-rizzotto-gold-700 bg-rizzotto-gold-500/10 px-3 py-1.5 text-sm text-rizzotto-gold-400 hover:bg-rizzotto-gold-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Faction Modal
// ---------------------------------------------------------------------------

interface AddFactionModalProps {
  onClose: () => void;
  onCreated: () => void;
}

function AddFactionModal({ onClose, onCreated }: AddFactionModalProps) {
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [race, setRace] = useState('');
  const [category, setCategory] = useState('');
  const [colorHex, setColorHex] = useState('#808080');
  const [error, setError] = useState<string | null>(null);

  const { mutate, isPending } = useMutation({
    mutationFn: () =>
      createAdminFaction({ slug, name, race, category, color_hex: colorHex }),
    onSuccess: () => { onCreated(); onClose(); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-full max-w-md rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-950 p-6 shadow-xl">
        <h3 className="font-display text-lg font-semibold text-rizzotto-gold-500 mb-4">
          Add Faction
        </h3>

        <div className="space-y-3">
          {[
            { label: 'Slug', val: slug, set: setSlug, placeholder: 'norsca' },
            { label: 'Name', val: name, set: setName, placeholder: 'Norsca' },
            { label: 'Race', val: race, set: setRace, placeholder: 'Norse' },
            { label: 'Category', val: category, set: setCategory, placeholder: 'Chaos' },
          ].map((field) => (
            <div key={field.label}>
              <label className="block text-xs text-stone-400 mb-1">{field.label}</label>
              <input
                className="w-full rounded border border-stone-700 bg-stone-900 px-3 py-1.5 text-sm text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none"
                value={field.val}
                onChange={(e) => field.set(e.target.value)}
                placeholder={field.placeholder}
              />
            </div>
          ))}
          <div>
            <label className="block text-xs text-stone-400 mb-1">Color</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={colorHex}
                onChange={(e) => setColorHex(e.target.value)}
                className="h-8 w-12 cursor-pointer rounded border border-stone-700 bg-stone-900 p-0.5"
              />
              <span className="font-mono text-xs text-stone-400">{colorHex}</span>
            </div>
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
            disabled={isPending || !slug || !name || !race || !category}
            className="rounded border border-rizzotto-gold-700 bg-rizzotto-gold-500/10 px-4 py-1.5 text-sm text-rizzotto-gold-400 hover:bg-rizzotto-gold-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isPending ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

function InlineInput({
  value,
  onSave,
}: {
  value: string;
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => { setDraft(value); setEditing(true); }}
        className="text-left text-stone-200 hover:text-rizzotto-gold-400 transition-colors cursor-text"
      >
        {value || <span className="text-stone-600 italic">—</span>}
      </button>
    );
  }

  function commit() {
    if (draft !== value) onSave(draft);
    setEditing(false);
  }

  return (
    <input
      className="w-full rounded border border-rizzotto-gold-700 bg-stone-900 px-2 py-0.5 text-xs text-stone-200 focus:outline-none"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
      autoFocus
    />
  );
}

export function FactionManager() {
  const queryClient = useQueryClient();
  const [sigilTarget, setSigilTarget] = useState<AdminFactionDto | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-factions'],
    queryFn: getAdminFactions,
  });

  const factions = data?.data ?? [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-factions'] });
    queryClient.invalidateQueries({ queryKey: ['factions'] });
  };

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: Partial<{ name: string; race: string; category: string; color_hex: string; display_order: number }>;
    }) => updateAdminFaction(id, body),
    onSuccess: invalidate,
  });

  if (isLoading) {
    return <div className="py-8 text-center text-stone-400 text-sm">Loading…</div>;
  }

  if (error) {
    return (
      <div className="rounded border border-red-900 bg-red-950/40 p-3 text-red-300 text-xs">
        Failed to load factions.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-display text-base font-semibold text-rizzotto-gold-400">
          Faction Manager ({factions.length} factions)
        </h3>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="rounded border border-rizzotto-gold-700 bg-rizzotto-gold-500/10 px-3 py-1.5 text-xs text-rizzotto-gold-400 hover:bg-rizzotto-gold-500/20 transition-colors"
        >
          + Add Faction
        </button>
      </div>

      <div className="overflow-x-auto rounded-md border border-stone-800">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="border-b border-stone-800 bg-stone-900/60">
              <th className="px-3 py-2 text-left text-stone-400 w-10">Sigil</th>
              <th className="px-3 py-2 text-left text-stone-400 w-28">Slug</th>
              <th className="px-3 py-2 text-left text-stone-400">Name</th>
              <th className="px-3 py-2 text-left text-stone-400 hidden md:table-cell">Race</th>
              <th className="px-3 py-2 text-left text-stone-400 hidden md:table-cell">Category</th>
              <th className="px-3 py-2 text-center text-stone-400 w-14 hidden lg:table-cell">Color</th>
              <th className="px-3 py-2 text-right text-stone-400 w-12 hidden lg:table-cell">Order</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-800/60">
            {factions.map((f) => (
              <tr key={f.id} className="hover:bg-stone-800/20 transition-colors">
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setSigilTarget(f)}
                    title="Click to upload sigil"
                    className="group relative"
                  >
                    {f.icon_url ? (
                      <img
                        src={f.icon_url}
                        alt={f.name}
                        className="h-8 w-8 object-contain rounded border border-stone-700 group-hover:border-rizzotto-gold-600 transition-colors"
                      />
                    ) : (
                      <span className="h-8 w-8 flex items-center justify-center rounded border border-stone-700 group-hover:border-rizzotto-gold-600 bg-stone-800 text-[10px] font-semibold text-stone-400 transition-colors">
                        {f.name.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                  </button>
                </td>
                <td className="px-3 py-2 font-mono text-stone-500">{f.slug}</td>
                <td className="px-3 py-2">
                  <InlineInput
                    value={f.name}
                    onSave={(name) => updateMutation.mutate({ id: f.id, body: { name } })}
                  />
                </td>
                <td className="px-3 py-2 hidden md:table-cell">
                  <InlineInput
                    value={f.race}
                    onSave={(race) => updateMutation.mutate({ id: f.id, body: { race } })}
                  />
                </td>
                <td className="px-3 py-2 hidden md:table-cell">
                  <InlineInput
                    value={f.category}
                    onSave={(category) =>
                      updateMutation.mutate({ id: f.id, body: { category } })
                    }
                  />
                </td>
                <td className="px-3 py-2 text-center hidden lg:table-cell">
                  <input
                    type="color"
                    value={f.color_hex}
                    onChange={(e) =>
                      updateMutation.mutate({ id: f.id, body: { color_hex: e.target.value } })
                    }
                    className="h-6 w-10 cursor-pointer rounded border border-stone-700 bg-stone-900 p-0.5"
                  />
                </td>
                <td className="px-3 py-2 text-right hidden lg:table-cell">
                  <InlineInput
                    value={String(f.display_order)}
                    onSave={(v) => {
                      const n = parseInt(v, 10);
                      if (!isNaN(n)) updateMutation.mutate({ id: f.id, body: { display_order: n } });
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sigilTarget && (
        <SigilUploadModal
          faction={sigilTarget}
          onClose={() => setSigilTarget(null)}
          onUploaded={invalidate}
        />
      )}

      {showAdd && (
        <AddFactionModal onClose={() => setShowAdd(false)} onCreated={invalidate} />
      )}
    </div>
  );
}
