import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listVersions,
  createVersion,
  patchVersion,
  deleteVersion,
  getQuarters,
  patchQuarter,
  type VersionSummary,
  type QuarterAdminEntry,
  type ApiError,
} from '@/lib/api.js';

// ── helpers ────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/** datetime-local value (YYYY-MM-DDTHH:MM) → ISO string, or null if empty */
function localToIso(local: string): string | null {
  if (!local.trim()) return null;
  return new Date(local).toISOString();
}

/** ISO string → datetime-local value (YYYY-MM-DDTHH:MM) for input */
function isoToLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  // datetime-local needs "YYYY-MM-DDTHH:MM"
  return iso.slice(0, 16);
}

function isApiError(e: unknown): e is ApiError {
  return typeof e === 'object' && e !== null && 'message' in e;
}

// ── Game Versions ──────────────────────────────────────────────────────────

const EMPTY_VERSION_FORM = {
  name: '',
  start_date: '',
  end_date: '',
  is_active: false,
  dlc_tag: '',
};

function GameVersionsSection() {
  const qc = useQueryClient();
  const [form, setForm] = useState(EMPTY_VERSION_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'versions'],
    queryFn: listVersions,
  });

  const activateMutation = useMutation({
    mutationFn: (id: string) => patchVersion(id, { is_active: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'versions'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteVersion(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'versions'] }),
  });

  const createMutation = useMutation({
    mutationFn: () => {
      const startIso = localToIso(form.start_date);
      const endIso = localToIso(form.end_date);
      if (!form.name.trim()) throw new Error('Name is required.');
      if (!startIso) throw new Error('Start date is required.');
      if (!endIso) throw new Error('End date is required.');
      return createVersion({
        name: form.name.trim(),
        start_date: startIso,
        end_date: endIso,
        is_active: form.is_active || undefined,
        dlc_tag: form.dlc_tag.trim() || undefined,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'versions'] });
      setForm(EMPTY_VERSION_FORM);
      setFormError(null);
    },
    onError: (e) => {
      setFormError(isApiError(e) ? e.message : String(e));
    },
  });

  function handleDelete(v: VersionSummary) {
    if (!window.confirm(`Delete version "${v.name}"? This cannot be undone.`)) return;
    deleteMutation.mutate(v.id);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    createMutation.mutate();
  }

  const versions = data?.data ?? [];

  return (
    <section className="rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-5">
      <h3 className="font-display text-base font-semibold text-rizzotto-gold-400 mb-4">
        Game Versions
      </h3>

      {isLoading && (
        <div className="py-4 text-center text-stone-400 text-sm">Loading…</div>
      )}

      {error && (
        <div className="rounded border border-red-900 bg-red-950/40 p-3 text-red-300 text-xs mb-4">
          Failed to load versions.
        </div>
      )}

      {!isLoading && versions.length === 0 && (
        <p className="text-stone-500 text-sm mb-4">No versions yet.</p>
      )}

      {versions.length > 0 && (
        <div className="space-y-2 mb-6">
          {versions.map((v) => (
            <div
              key={v.id}
              className="flex flex-wrap items-center gap-3 rounded border border-rizzotto-iron-700 bg-rizzotto-iron-800/50 px-4 py-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-stone-100">{v.name}</span>
                  {v.is_active && (
                    <span className="rounded bg-rizzotto-gold-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rizzotto-gold-400 border border-rizzotto-gold-700">
                      Active
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-[11px] text-stone-500">
                  {fmtDate(v.start_date)} – {fmtDate(v.end_date)}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {!v.is_active && (
                  <button
                    type="button"
                    onClick={() => activateMutation.mutate(v.id)}
                    disabled={activateMutation.isPending}
                    className="rounded border border-rizzotto-gold-700 px-2.5 py-1 text-xs text-rizzotto-gold-400 hover:bg-rizzotto-gold-500/10 disabled:opacity-50 transition-colors"
                  >
                    Activate
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleDelete(v)}
                  disabled={deleteMutation.isPending}
                  className="rounded border border-red-800 px-2.5 py-1 text-xs text-red-400 hover:bg-red-900/20 disabled:opacity-50 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create form */}
      <div className="rounded border border-rizzotto-iron-600 bg-rizzotto-iron-950/60 p-4">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-stone-400 mb-3">
          Create version
        </h4>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-stone-400 sm:col-span-2">
            Name *
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. v5.1 — Champions of Chaos"
              required
              className="rounded border border-stone-700 bg-stone-900 px-2 py-1.5 text-xs text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-stone-400">
            Start *
            <input
              type="datetime-local"
              value={form.start_date}
              onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
              required
              className="rounded border border-stone-700 bg-stone-900 px-2 py-1.5 text-xs text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-stone-400">
            End *
            <input
              type="datetime-local"
              value={form.end_date}
              onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
              required
              className="rounded border border-stone-700 bg-stone-900 px-2 py-1.5 text-xs text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-stone-400">
            DLC tag (optional)
            <input
              type="text"
              value={form.dlc_tag}
              onChange={(e) => setForm((f) => ({ ...f, dlc_tag: e.target.value }))}
              placeholder="e.g. chaos-dwarfs"
              className="rounded border border-stone-700 bg-stone-900 px-2 py-1.5 text-xs text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none"
            />
          </label>

          <div className="flex items-center gap-2 sm:col-span-2">
            <input
              type="checkbox"
              id="version-set-active"
              checked={form.is_active}
              onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
              className="accent-rizzotto-gold-500"
            />
            <label htmlFor="version-set-active" className="text-xs text-stone-300 select-none cursor-pointer">
              Set as active version immediately
            </label>
          </div>

          {formError && (
            <div className="sm:col-span-2 rounded border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-300">
              {formError}
            </div>
          )}

          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="rounded border border-rizzotto-gold-600 bg-rizzotto-gold-500/10 px-4 py-1.5 text-xs font-medium text-rizzotto-gold-400 hover:bg-rizzotto-gold-500/20 disabled:opacity-50 transition-colors"
            >
              {createMutation.isPending ? 'Creating…' : 'Create version'}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

// ── Quarters ───────────────────────────────────────────────────────────────

type QuarterEditState = {
  name: string;
  start_date: string;
  end_date: string;
};

function QuarterRow({ entry }: { entry: QuarterAdminEntry }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [edit, setEdit] = useState<QuarterEditState>({
    name: entry.override?.name ?? '',
    start_date: isoToLocal(entry.override?.start_date),
    end_date: isoToLocal(entry.override?.end_date),
  });
  const [saveError, setSaveError] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: () =>
      patchQuarter(entry.period, {
        name: edit.name.trim() || null,
        start_date: localToIso(edit.start_date),
        end_date: localToIso(edit.end_date),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'quarters'] });
      setSaveError(null);
      setExpanded(false);
    },
    onError: (e) => {
      setSaveError(isApiError(e) ? e.message : String(e));
    },
  });

  const resetMutation = useMutation({
    mutationFn: () => patchQuarter(entry.period, { name: null, start_date: null, end_date: null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'quarters'] });
      setEdit({ name: '', start_date: '', end_date: '' });
      setExpanded(false);
    },
  });

  const hasOverride = entry.override !== null;

  return (
    <div className="rounded border border-rizzotto-iron-700 bg-rizzotto-iron-800/50">
      {/* summary row */}
      <div
        className="flex flex-wrap items-center gap-3 px-4 py-3 cursor-pointer select-none"
        onClick={() => setExpanded((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-stone-100">{entry.label}</span>
            <span className="text-[11px] text-stone-500 font-mono">{entry.period}</span>
            {hasOverride && (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-400 border border-amber-700">
                custom
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[11px] text-stone-500">
            {fmtDate(entry.from)} – {fmtDate(entry.to)}
          </div>
        </div>
        <span className="text-xs text-stone-500">{expanded ? '▲' : '▼'}</span>
      </div>

      {/* edit panel */}
      {expanded && (
        <div className="border-t border-rizzotto-iron-700 px-4 py-4 space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-stone-400 sm:col-span-2">
              Name override
              <input
                type="text"
                value={edit.name}
                onChange={(e) => setEdit((s) => ({ ...s, name: e.target.value }))}
                placeholder={entry.defaultLabel}
                className="rounded border border-stone-700 bg-stone-900 px-2 py-1.5 text-xs text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none"
              />
              <span className="text-[10px] text-stone-600">Leave empty to use calendar default: {entry.defaultLabel}</span>
            </label>

            <label className="flex flex-col gap-1 text-xs text-stone-400">
              Start override
              <input
                type="datetime-local"
                value={edit.start_date}
                onChange={(e) => setEdit((s) => ({ ...s, start_date: e.target.value }))}
                className="rounded border border-stone-700 bg-stone-900 px-2 py-1.5 text-xs text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none"
              />
              <span className="text-[10px] text-stone-600">Calendar default: {fmtDate(entry.defaultFrom)}</span>
            </label>

            <label className="flex flex-col gap-1 text-xs text-stone-400">
              End override
              <input
                type="datetime-local"
                value={edit.end_date}
                onChange={(e) => setEdit((s) => ({ ...s, end_date: e.target.value }))}
                className="rounded border border-stone-700 bg-stone-900 px-2 py-1.5 text-xs text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none"
              />
              <span className="text-[10px] text-stone-600">Calendar default: {fmtDate(entry.defaultTo)}</span>
            </label>
          </div>

          {saveError && (
            <div className="rounded border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-300">
              {saveError}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || resetMutation.isPending}
              className="rounded border border-rizzotto-gold-600 bg-rizzotto-gold-500/10 px-3 py-1.5 text-xs font-medium text-rizzotto-gold-400 hover:bg-rizzotto-gold-500/20 disabled:opacity-50 transition-colors"
            >
              {saveMutation.isPending ? 'Saving…' : 'Save'}
            </button>
            {hasOverride && (
              <button
                type="button"
                onClick={() => resetMutation.mutate()}
                disabled={saveMutation.isPending || resetMutation.isPending}
                className="rounded border border-stone-700 px-3 py-1.5 text-xs text-stone-400 hover:bg-stone-800 disabled:opacity-50 transition-colors"
              >
                {resetMutation.isPending ? 'Resetting…' : 'Reset to calendar'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function QuartersSection() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'quarters'],
    queryFn: getQuarters,
  });

  const quarters = data?.data ?? [];

  return (
    <section className="rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-5">
      <h3 className="font-display text-base font-semibold text-rizzotto-gold-400 mb-4">
        Quarters
      </h3>

      {isLoading && (
        <div className="py-4 text-center text-stone-400 text-sm">Loading…</div>
      )}

      {error && (
        <div className="rounded border border-red-900 bg-red-950/40 p-3 text-red-300 text-xs">
          Failed to load quarters.
        </div>
      )}

      {!isLoading && quarters.length === 0 && (
        <p className="text-stone-500 text-sm">No quarters found.</p>
      )}

      <div className="space-y-2">
        {quarters.map((q) => (
          <QuarterRow key={q.period} entry={q} />
        ))}
      </div>
    </section>
  );
}

// ── Root export ────────────────────────────────────────────────────────────

export function AdminCompetitionTab() {
  return (
    <div className="space-y-8">
      <GameVersionsSection />
      <QuartersSection />
    </div>
  );
}
