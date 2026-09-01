import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAnnouncementDestinations,
  putAnnouncementDestinations,
  getAnnouncementPrompt,
  getAnnouncementDrafts,
  getAnnouncementPushTokenStatus,
  rotateAnnouncementPushToken,
  listTournaments,
  type AnnouncementDestination,
  type AnnouncementLength,
  type AnnouncementDraftResult,
  type Tournament,
} from '@/lib/api.js';

const LENGTHS: AnnouncementLength[] = ['SHORT', 'MEDIUM', 'LONG'];
const UPCOMING_STATUSES = ['DRAFT', 'OPEN_REGISTRATION', 'REGISTRATION_CLOSED'];

function newDestination(): AnnouncementDestination {
  return {
    id: crypto.randomUUID(),
    name: 'New destination',
    ref: '',
    brief: '',
    explain_level: 'NONE',
    always_mention: '',
    avoid: '',
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
const primaryBtn =
  'rounded border border-rizzotto-gold-700 bg-rizzotto-gold-500/10 px-4 py-1.5 text-sm text-rizzotto-gold-400 transition-colors hover:bg-rizzotto-gold-500/20 disabled:cursor-not-allowed disabled:opacity-40';

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
          <div className="md:col-span-2">
            <label className={labelClass}>Ref (link tag — appended as ?ref= to the sign-up link)</label>
            <input
              value={dest.ref}
              onChange={(e) => set('ref', e.target.value)}
              placeholder="blank = derived from the name (e.g. tw-official)"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Explanation level</label>
            <select
              value={dest.explain_level}
              onChange={(e) => set('explain_level', e.target.value as AnnouncementDestination['explain_level'])}
              className={inputClass}
            >
              <option value="NONE">No explanation (insiders)</option>
              <option value="BASIC">Short / basic reminder</option>
              <option value="FULL">Full explanation (newcomers)</option>
            </select>
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
            <label className={labelClass}>General brief</label>
            <textarea
              rows={2}
              value={dest.brief}
              onChange={(e) => set('brief', e.target.value)}
              placeholder="What this server is, its vibe, the angle. e.g. Official Total War Discord, warm and welcoming to newcomers."
              className={`${inputClass} resize-y`}
            />
          </div>
          <div className="md:col-span-2">
            <label className={labelClass}>Always mention</label>
            <textarea
              rows={2}
              value={dest.always_mention}
              onChange={(e) => set('always_mention', e.target.value)}
              placeholder="Must-include points. e.g. the cash prize; DLC for semi-finalists."
              className={`${inputClass} resize-y`}
            />
          </div>
          <div className="md:col-span-2">
            <label className={labelClass}>Avoid / never say</label>
            <textarea
              rows={2}
              value={dest.avoid}
              onChange={(e) => set('avoid', e.target.value)}
              placeholder="Anything to leave out."
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

function DraftCard({ result }: { result: AnnouncementDraftResult }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.text);
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
        <button type="button" onClick={copy} disabled={!result.text} className={primaryBtn}>
          {copied ? 'Copied!' : 'Copy Announcement'}
        </button>
      </div>
      <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded border border-stone-800 bg-stone-950 px-3 py-2 font-mono text-xs text-stone-200">
        {result.text}
      </pre>
    </div>
  );
}

export function AnnouncementsTab() {
  const queryClient = useQueryClient();

  // --- Destinations ---
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

  // --- Push token ---
  const { data: tokenStatus } = useQuery({
    queryKey: ['announcement-push-token'],
    queryFn: getAnnouncementPushTokenStatus,
    retry: false,
  });
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const { mutate: rotate, isPending: rotating } = useMutation({
    mutationFn: rotateAnnouncementPushToken,
    onSuccess: (r) => {
      setRevealedToken(r.token);
      void queryClient.invalidateQueries({ queryKey: ['announcement-push-token'] });
    },
  });

  // --- Upcoming tournaments ---
  const { data: tournaments = [], isLoading: tournamentsLoading } = useQuery({
    queryKey: ['announcement-tournaments'],
    queryFn: fetchAllTournaments,
  });
  const upcoming = tournaments
    .filter((t) => UPCOMING_STATUSES.includes(t.status))
    .sort((a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime());

  const [selected, setSelected] = useState<Tournament | null>(null);

  // --- Drafts for the selected tournament ---
  const {
    data: draftsData,
    isFetching: draftsFetching,
    refetch: refetchDrafts,
  } = useQuery({
    queryKey: ['announcement-drafts', selected?.slug],
    queryFn: () => getAnnouncementDrafts(selected!.slug),
    enabled: !!selected,
  });
  const draft = draftsData?.draft ?? null;

  // --- Copy prompt ---
  const [promptBusy, setPromptBusy] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const copyPrompt = async () => {
    if (!selected) return;
    setPromptBusy(true);
    setPromptError(null);
    try {
      const { prompt } = await getAnnouncementPrompt(selected.slug, notes);
      await navigator.clipboard.writeText(prompt);
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 2500);
    } catch (e) {
      setPromptError((e as Error).message);
    } finally {
      setPromptBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      {/* ---- Destinations ---- */}
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
          Each destination is a reusable brief for one Discord server: its general brief, explanation level, length,
          role mention and intro/outro. Define once, reuse for every tournament.
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
          <button type="button" onClick={() => save()} disabled={saving || !dirty} className={primaryBtn}>
            {saving ? 'Saving…' : 'Save destinations'}
          </button>
          {dirty && <span className="text-xs text-amber-400">Unsaved changes</span>}
        </div>
      </section>

      {/* ---- Announce a tournament ---- */}
      <section className="border-t border-stone-800 pt-6">
        <h3 className="mb-1 font-display text-base font-semibold text-rizzotto-gold-400">Announce a tournament</h3>
        <p className="mb-4 text-xs text-stone-500">
          Pick an upcoming tournament, copy its prompt, and paste it into a Claude Code session. Claude writes a
          polished post per destination and pushes them back here — each with a Copy button.
        </p>

        <div className="flex flex-col gap-6 lg:flex-row">
          {/* Upcoming list */}
          <div className="lg:w-72 lg:shrink-0">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-rizzotto-gold-500/80">Upcoming</h4>
            {tournamentsLoading && <div className="py-4 text-sm text-stone-400">Loading…</div>}
            <ul className="max-h-[60vh] divide-y divide-stone-800/60 overflow-y-auto rounded-md border border-stone-800">
              {upcoming.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(t)}
                    className={`flex w-full flex-col items-start px-3 py-2 text-left transition-colors hover:bg-stone-800/40 ${
                      selected?.id === t.id ? 'bg-stone-800/60' : ''
                    }`}
                  >
                    <span className="text-sm text-stone-200">{t.name}</span>
                    <span className="text-xs text-stone-500">
                      {new Date(t.start_date).toLocaleDateString()} · {t.status.replace(/_/g, ' ').toLowerCase()}
                    </span>
                  </button>
                </li>
              ))}
              {!tournamentsLoading && upcoming.length === 0 && (
                <li className="px-3 py-4 text-sm text-stone-500">No upcoming tournaments.</li>
              )}
            </ul>
          </div>

          {/* Selected tournament — prompt + drafts */}
          <div className="min-w-0 flex-1">
            {!selected && (
              <div className="py-8 text-center text-sm text-stone-500">Select an upcoming tournament.</div>
            )}
            {selected && (
              <>
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <h4 className="font-display text-base font-semibold text-rizzotto-gold-400">{selected.name}</h4>
                  <button type="button" onClick={copyPrompt} disabled={promptBusy} className={primaryBtn}>
                    {promptBusy ? 'Copying…' : promptCopied ? 'Prompt copied!' : 'Copy prompt for Claude'}
                  </button>
                  <button
                    type="button"
                    onClick={() => refetchDrafts()}
                    disabled={draftsFetching}
                    className="rounded border border-stone-700 px-3 py-1.5 text-sm text-stone-300 transition-colors hover:bg-stone-800 disabled:opacity-40"
                  >
                    {draftsFetching ? 'Refreshing…' : 'Refresh drafts'}
                  </button>
                </div>
                <div className="mb-3">
                  <label className={labelClass}>Anything specific this time? (optional)</label>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Prize, special rule, schedule note — whatever's specific to this announcement and not already in the tournament. Left blank = just the tournament facts."
                    className={`${inputClass} resize-y`}
                  />
                </div>
                {promptCopied && (
                  <p className="mb-3 text-xs text-stone-400">
                    Prompt is on your clipboard — paste it into your Claude Code session. The finished posts appear
                    below once Claude pushes them (hit “Refresh drafts”).
                  </p>
                )}
                {promptError && <p className="mb-3 text-xs text-red-400">{promptError}</p>}

                {draft ? (
                  <div className="flex flex-col gap-4">
                    <p className="text-xs text-stone-500">
                      Pushed {new Date(draft.generatedAt).toLocaleString()} · {draft.results.length} destination
                      {draft.results.length === 1 ? '' : 's'}
                    </p>
                    {draft.results.map((r) => (
                      <DraftCard key={r.destinationId} result={r} />
                    ))}
                  </div>
                ) : (
                  <div className="rounded border border-dashed border-stone-800 px-3 py-8 text-center text-sm text-stone-500">
                    No drafts yet. Copy the prompt, run it in Claude Code, then refresh.
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      {/* ---- Push token ---- */}
      <section className="border-t border-stone-800 pt-6">
        <h3 className="mb-1 font-display text-base font-semibold text-rizzotto-gold-400">Push token</h3>
        <p className="mb-3 text-xs text-stone-500">
          A scoped, non-expiring token that lets your Claude Code session push finished drafts back into this tab. It
          can do nothing else. Generate it once, hand it to Claude once. Rotating invalidates the old one immediately.
        </p>

        <div className="flex items-center gap-3">
          <button type="button" onClick={() => rotate()} disabled={rotating} className={primaryBtn}>
            {rotating ? 'Generating…' : tokenStatus?.configured ? 'Rotate token' : 'Generate token'}
          </button>
          <span className="text-xs text-stone-500">
            {tokenStatus?.configured ? 'A token is currently set.' : 'No token set yet.'}
          </span>
        </div>

        {revealedToken && (
          <div className="mt-3 rounded border border-rizzotto-gold-800/60 bg-rizzotto-gold-500/5 p-3">
            <p className="mb-1 text-xs text-amber-300">
              Copy this now — it is shown only once. Hand it to your Claude Code session.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded bg-stone-950 px-2 py-1 font-mono text-xs text-stone-200">
                {revealedToken}
              </code>
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(revealedToken)}
                className="rounded border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-800"
              >
                Copy
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
