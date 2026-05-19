import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAdminMaps,
  createAdminMap,
  updateAdminMap,
  deleteAdminMap,
  uploadAdminMapImage,
  type MapDto,
} from '@/lib/api.js';

interface AddMapModalProps {
  onClose: () => void;
  onCreated: () => void;
}

function AddMapModal({ onClose, onCreated }: AddMapModalProps) {
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { mutate, isPending } = useMutation({
    mutationFn: () => createAdminMap({ slug, name, description: description || undefined }),
    onSuccess: () => { onCreated(); onClose(); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-full max-w-md rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-950 p-6 shadow-xl">
        <h3 className="font-display text-lg font-semibold text-rizzotto-gold-500 mb-4">
          Add Map
        </h3>

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
        </div>

        {error && (
          <p className="mt-3 text-xs text-red-400">{error}</p>
        )}

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

export function MapPoolEditor() {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-maps'],
    queryFn: getAdminMaps,
  });

  const maps = data?.data ?? [];
  const active = maps.filter((m) => !m.deleted_at);
  const deleted = maps.filter((m) => m.deleted_at);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-maps'] });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { name?: string; description?: string } }) =>
      updateAdminMap(id, body),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAdminMap(id),
    onSuccess: invalidate,
  });

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !uploadingFor) return;
    void uploadAdminMapImage(uploadingFor, file).then(invalidate);
    e.target.value = '';
    setUploadingFor(null);
  }

  if (isLoading) {
    return <div className="py-8 text-center text-stone-400 text-sm">Loading…</div>;
  }

  if (error) {
    return (
      <div className="rounded border border-red-900 bg-red-950/40 p-3 text-red-300 text-xs">
        Failed to load maps.
      </div>
    );
  }

  function MapTable({ rows, showDelete }: { rows: MapDto[]; showDelete: boolean }) {
    return (
      <div className="overflow-x-auto rounded-md border border-stone-800">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="border-b border-stone-800 bg-stone-900/60">
              <th className="px-3 py-2 text-left text-stone-400 w-12">Image</th>
              <th className="px-3 py-2 text-left text-stone-400 w-32">Slug</th>
              <th className="px-3 py-2 text-left text-stone-400">Name</th>
              <th className="px-3 py-2 text-left text-stone-400 hidden sm:table-cell">Description</th>
              <th className="px-3 py-2 text-right text-stone-400 w-24">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-800/60">
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-stone-500">
                  None.
                </td>
              </tr>
            )}
            {rows.map((m) => (
              <tr key={m.id} className="hover:bg-stone-800/20 transition-colors">
                <td className="px-3 py-2">
                  <div className="relative group">
                    {m.image_url ? (
                      <img
                        src={m.image_url}
                        alt={m.name}
                        className="h-9 w-14 object-cover rounded border border-stone-700"
                      />
                    ) : (
                      <div className="h-9 w-14 rounded border border-stone-700 bg-stone-800 flex items-center justify-center text-[10px] text-stone-600">
                        No img
                      </div>
                    )}
                    {showDelete && (
                      <button
                        type="button"
                        onClick={() => {
                          setUploadingFor(m.id);
                          fileInputRef.current?.click();
                        }}
                        className="absolute inset-0 flex items-center justify-center rounded bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-stone-200"
                      >
                        Upload
                      </button>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 text-stone-500 font-mono">{m.slug}</td>
                <td className="px-3 py-2">
                  {showDelete ? (
                    <InlineEdit
                      value={m.name}
                      onSave={(name) => updateMutation.mutate({ id: m.id, body: { name } })}
                    />
                  ) : (
                    <span className="text-stone-500 line-through">{m.name}</span>
                  )}
                </td>
                <td className="px-3 py-2 hidden sm:table-cell">
                  {showDelete ? (
                    <InlineEdit
                      value={m.description ?? ''}
                      onSave={(description) =>
                        updateMutation.mutate({ id: m.id, body: { description } })
                      }
                      placeholder="no description"
                      multiline
                    />
                  ) : (
                    <span className="text-stone-600 text-xs">{m.description ?? '—'}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {showDelete && (
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Delete map "${m.name}"?`)) {
                          deleteMutation.mutate(m.id);
                        }
                      }}
                      className="rounded px-2 py-0.5 border border-red-800 text-red-400 hover:bg-red-900/30 transition-colors"
                      title="Soft-delete map"
                    >
                      ✕
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

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-display text-base font-semibold text-rizzotto-gold-400">
          Map Pool ({active.length} active)
        </h3>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="rounded border border-rizzotto-gold-700 bg-rizzotto-gold-500/10 px-3 py-1.5 text-xs text-rizzotto-gold-400 hover:bg-rizzotto-gold-500/20 transition-colors"
        >
          + Add Map
        </button>
      </div>

      <MapTable rows={active} showDelete />

      {deleted.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-stone-500 hover:text-stone-300 select-none">
            Show {deleted.length} soft-deleted map(s)
          </summary>
          <div className="mt-2">
            <MapTable rows={deleted} showDelete={false} />
          </div>
        </details>
      )}

      {/* Hidden file input for image upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={handleImageUpload}
      />

      {showAdd && (
        <AddMapModal onClose={() => setShowAdd(false)} onCreated={invalidate} />
      )}
    </div>
  );
}
