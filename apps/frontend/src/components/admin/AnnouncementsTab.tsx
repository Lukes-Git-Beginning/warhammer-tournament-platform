import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAnnouncementDestinations,
  putAnnouncementDestinations,
  generateAnnouncements,
  listTournaments,
  type AnnouncementDestination,
  type AnnouncementLength,
  type GeneratedAnnouncement,
  type Tournament,
  type ApiError,
} from '@/lib/api.js';

const LENGTHS: AnnouncementLength[] = ['SHORT', 'MEDIUM', 'LONG'];

function newDestination(): AnnouncementDestination {
  return {
    id: crypto.randomUUID(),
    name: 'New destination',
    brief: '',
    tone: '',
    length: 'MEDIUM',
    role_mention: '',
    intro: '',
    outro: '',
  };
}

/** The tournaments list caps pageSize at 100 — page through to get all of them. */
async function fetchAllTournaments(): Promise<Tournament[]> {
  const pageSize = 100;
  const first = await listTournaments(1, pageSize);
  const all = [...first.data];
  const totalPages = Math.ceil(first.total / pageSize);
  for (let p = 2; p <= totalPages; p++) {
    const next = await listTournaments(p, pageSize);
    all.push(...next.data);
  }
  return all;
}

const inputClass =
  'w-full rounded border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none';
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-rizzotto-gold-500/80';

function DestinationRow({
  dest,
  onChange,
  onDelete,
}: {
  dest: AnnouncementDestination;
  onChange: (d: AnnouncementDestination) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const set = <K extends keyof AnnouncementDestination>(k: K, v: AnnouncementDestination[K]) =>
    onChange({ ...dest, [k]: v });

  return (
    <div className="rounded-md border border-stone-800 bg-stone-900/40">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="text-stone-500 transition-colors hover:text-stone-300"
          aria-label={open ? 'Collapse' : 'Expand'}
        >
          {open ? '▾' : '▸'}
        </button>
        <input
          value={dest.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="Destination name (e.g. Official TW Discord)"
          className="flex-1 bg-transparent text-sm font-medium text-stone-100 focus:outline-none"
        />
        <span className="rounded bg-stone-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-stone-400">
          {dest.length}
        </span>
        <button
          type="button"
          onClick={onDelete}
          className="rounded px-2 py-0.5 text-xs text-red-400/80 transition-colors hover:bg-red-500/10 hover:text-red-300"
        >
          Delete
        </button>
      </div>

      {open && (
        <div className="grid gap-3 border-t border-stone-800 px-3 py-3 md:grid-cols-2">
          <div>
            <label className={labelClass}>Tone</label>
            <input
              value={dest.tone}
              onChange={(e) => set('tone', e.target.value)}
              placeholder="e.g. warm and inviting to newcomers"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Length</label>
            <select
              value={dest.length}
              onChange={(e) => set('length', e.target.value as AnnouncementLength)}
              className={inputClass}
            >
              {LENGTHS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className={labelClass}>Focus / brief</label>
            <textarea
              rows={3}
              value={dest.brief}
              onChange={(e) => set('brief', e.target.value)}
              placeholder="What this server needs emphasised or assumed. e.g. Explain that this is a Domination ruleset; be especially welcoming to new players."
              className={`${inputClass} resize-y`}
            />
          </div>
          <div>
            <label className={labelClass}>Role mention (verbatim)</label>
            <input
              value={dest.role_mention}
              onChange={(e) => set('role_mention', e.target.value)}
              placeholder="@everyone or <@&123456789>"
              className={inputClass}
            />
          </div>
          <div />
          <div>
            <label className={labelClass}>Intro (optional)</label>
            <textarea
              rows={2}
              value={dest.intro}
              onChange={(e) => set('intro', e.target.value)}
              className={`${inputClass} resize-y`}
            />
          </div>
          <div>
            <label className={labelClass}>Outro (optional)</label>
            <textarea
              rows={2}
              value={dest.outro}
              onChange={(e) => set('outro', e.target.value)}
              className={`${inputClass} resize-y`}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ResultCard({
  result,
  onRegenerate,
  regenerating,
}: {
  result: GeneratedAnnouncement;
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  const [text, setText] = useState(result.text);
  const [copied, setCopied] = useState(false);
  useEffect(() => setText(result.text), [result.text]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="rounded-md border border-stone-800 bg-stone-900/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-rizzotto-gold-400">{result.name}</h4>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRegenerate}
            disabled={regenerating}
            className="rounded border border-stone-700 px-2 py-1 text-xs text-stone-300 transition-colors hover:bg-stone-800 disabled:opacity-40"
          >
            {regenerating ? 'Regenerating…' : 'Regenerate'}
          </button>
          <button
            type="button"
            onClick={copy}
            disabled={!text}
            className="rounded border border-rizzotto-gold-700 bg-rizzotto-gold-500/10 px-2 py-1 text-xs text-rizzotto-gold-400 transition-colors hover:bg-rizzotto-gold-500/20 disabled:opacity-40"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>
      {result.error ? (
        <p className="text-xs text-red-400">{result.error}</p>
      ) : (
        <textarea
          rows={Math.min(16, Math.max(5, text.split('\n').length + 1))}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="w-full resize-y rounded border border-stone-700 bg-stone-950 px-3 py-2 font-mono text-xs text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none"
        />
      )}
    </div>
  );
}

export function AnnouncementsTab() {
  const queryClient = useQueryClient();

  const { data: savedDestinations = [], isLoading: destLoading } = useQuery({
    queryKey: ['announcement-destinations'],
    queryFn: getAnnouncementDestinations,
    retry: false,
  });

  const [destinations, setDestinations] = useState<AnnouncementDestination[]>([]);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    setDestinations(savedDestinations);
    setDirty(false);
  }, [savedDestinations]);

  const { mutate: save, isPending: saving, error: saveError } = useMutation({
    mutationFn: () => putAnnouncementDestinations(destinations),
    onSuccess: () => {
      setDirty(false);
      void queryClient.invalidateQueries({ queryKey: ['announcement-destinations'] });
    },
  });

  const editList = (fn: (list: AnnouncementDestination[]) => AnnouncementDestination[]) => {
    setDestinations((prev) => fn(prev));
    setDirty(true);
  };

  // --- Generate section state ---
  const { data: tournaments = [], isLoading: tournamentsLoading } = useQuery({
    queryKey: ['announcement-tournaments'],
    queryFn: fetchAllTournaments,
  });

  const [slug, setSlug] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [results, setResults] = useState<GeneratedAnnouncement[]>([]);
  const [notConfigured, setNotConfigured] = useState(false);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);

  const toggleSelected = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const { mutate: generate, isPending: generating, error: generateError } = useMutation({
    mutationFn: (ids: string[]) => generateAnnouncements(slug, ids),
    onMutate: () => setNotConfigured(false),
    onSuccess: (res, ids) => {
      // Merge: replace results for the requested ids, keep the rest.
      setResults((prev) => {
        const byId = new Map(prev.map((r) => [r.id, r]));
        for (const r of res.results) byId.set(r.id, r);
        // Preserve the saved-destination order for stable display.
        return savedDestinations
          .filter((d) => byId.has(d.id) && (ids.includes(d.id) || prev.some((p) => p.id === d.id)))
          .map((d) => byId.get(d.id)!);
      });
    },
    onError: (err) => {
      if ((err as ApiError).status === 503) setNotConfigured(true);
    },
    onSettled: () => setRegeneratingId(null),
  });

  const canGenerate = !!slug && selectedIds.length > 0 && !generating;

  return (
    <div className="flex flex-col gap-8">
      {/* ---- Destinations manager ---- */}
      <section>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="font-display text-base font-semibold text-rizzotto-gold-400">Announcement destinations</h3>
          <button
            type="button"
            onClick={() => editList((l) => [...l, newDestination()])}
            className="rounded border border-stone-700 px-3 py-1 text-xs text-stone-300 transition-colors hover:bg-stone-800"
          >
            + Add destination
          </button>
        </div>
        <p className="mb-4 text-xs text-stone-500">
          Each destination is a reusable brief for one Discord server — its focus, tone, length, role mention and
          intro/outro. Define once, reuse for every tournament.
        </p>

        {destLoading && <div className="py-4 text-center text-sm text-stone-400">Loading…</div>}

        {!destLoading && (
          <div className="flex flex-col gap-2">
            {destinations.length === 0 && (
              <p className="rounded border border-dashed border-stone-800 px-3 py-6 text-center text-sm text-stone-500">
                No destinations yet. Add one to get started.
              </p>
            )}
            {destinations.map((d) => (
              <DestinationRow
                key={d.id}
                dest={d}
                onChange={(next) => editList((l) => l.map((x) => (x.id === d.id ? next : x)))}
                onDelete={() => editList((l) => l.filter((x) => x.id !== d.id))}
              />
            ))}
          </div>
        )}

        {saveError && <p className="mt-2 text-xs text-red-400">{(saveError as Error).message}</p>}

        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => save()}
            disabled={saving || !dirty}
            className="rounded border border-rizzotto-gold-700 bg-rizzotto-gold-500/10 px-4 py-1.5 text-sm text-rizzotto-gold-400 transition-colors hover:bg-rizzotto-gold-500/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save destinations'}
          </button>
          {dirty && <span className="text-xs text-amber-400">Unsaved changes</span>}
        </div>
      </section>

      {/* ---- Generate ---- */}
      <section className="border-t border-stone-800 pt-6">
        <h3 className="mb-1 font-display text-base font-semibold text-rizzotto-gold-400">Generate announcements</h3>
        <p className="mb-4 text-xs text-stone-500">
          Pick a tournament and the destinations to write for. The site drafts a ready-to-paste Discord post per
          destination — edit it, then copy.
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className={labelClass}>Tournament</label>
            <select value={slug} onChange={(e) => setSlug(e.target.value)} className={inputClass}>
              <option value="">{tournamentsLoading ? 'Loading…' : 'Select a tournament…'}</option>
              {tournaments.map((t) => (
                <option key={t.id} value={t.slug}>
                  {t.name} — {t.status}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Destinations</label>
            {savedDestinations.length === 0 ? (
              <p className="text-xs text-stone-500">Save at least one destination above first.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {savedDestinations.map((d) => (
                  <label
                    key={d.id}
                    className={`cursor-pointer rounded border px-2 py-1 text-xs transition-colors ${
                      selectedIds.includes(d.id)
                        ? 'border-rizzotto-gold-600 bg-rizzotto-gold-500/15 text-rizzotto-gold-300'
                        : 'border-stone-700 text-stone-400 hover:bg-stone-800'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={selectedIds.includes(d.id)}
                      onChange={() => toggleSelected(d.id)}
                    />
                    {d.name}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        {dirty && (
          <p className="mt-2 text-xs text-amber-400">
            You have unsaved destination edits — generation uses the last saved version. Save first to use your latest
            changes.
          </p>
        )}

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => generate(selectedIds)}
            disabled={!canGenerate}
            className="rounded border border-rizzotto-gold-700 bg-rizzotto-gold-500/10 px-4 py-1.5 text-sm text-rizzotto-gold-400 transition-colors hover:bg-rizzotto-gold-500/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {generating ? 'Generating…' : `Generate (${selectedIds.length})`}
          </button>
        </div>

        {notConfigured && (
          <p className="mt-3 rounded border border-amber-800/60 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
            AI generation is not configured yet (the server has no <code>ANTHROPIC_API_KEY</code>). Destination
            management works; text generation will light up once the key is set.
          </p>
        )}
        {generateError && !notConfigured && (
          <p className="mt-2 text-xs text-red-400">{(generateError as Error).message}</p>
        )}

        {results.length > 0 && (
          <div className="mt-5 flex flex-col gap-4">
            {results.map((r) => (
              <ResultCard
                key={r.id}
                result={r}
                regenerating={regeneratingId === r.id}
                onRegenerate={() => {
                  setRegeneratingId(r.id);
                  generate([r.id]);
                }}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
