import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getRuleDocuments, putAdminConfig, type RuleDocument } from '@/lib/api.js';
import { BATTLE_TYPE_LABELS } from '@rizzotto/types';

const CONFIG_KEY = 'rule_documents';
const BT_LABEL: Record<string, string> = BATTLE_TYPE_LABELS;

/**
 * Permalinks for full rules documents (e.g. the Fruit Rules). Each permalink (/rules/<slug>) forwards
 * to the URL set here, so when a new version of a document comes out only the target changes and every
 * link already shared keeps working. A document with an empty URL is not linked anywhere yet.
 */
export function RuleDocumentsEditor() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['rule-documents'], queryFn: getRuleDocuments, retry: false });

  const [docs, setDocs] = useState<RuleDocument[]>([]);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (data?.documents) setDocs(data.documents);
  }, [data]);

  const setField = (slug: string, field: 'label' | 'url') => (v: string) => {
    setSaved(false);
    setDocs((prev) => prev.map((d) => (d.slug === slug ? { ...d, [field]: v } : d)));
  };

  const permalink = (slug: string) => `${window.location.origin}/rules/${slug}`;
  const copy = async (slug: string) => {
    try {
      await navigator.clipboard.writeText(permalink(slug));
      setCopied(slug);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  const invalidUrl = docs.some((d) => d.url.trim() !== '' && !/^https?:\/\/\S+$/i.test(d.url.trim()));

  const { mutate, isPending, error: saveError } = useMutation({
    mutationFn: () => putAdminConfig(CONFIG_KEY, docs.map((d) => ({ ...d, label: d.label.trim(), url: d.url.trim() }))),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      void queryClient.invalidateQueries({ queryKey: ['rule-documents'] });
    },
  });

  return (
    <div>
      <h3 className="mb-1 font-display text-base font-semibold text-rizzotto-gold-400">Rules Documents</h3>
      <p className="mb-3 text-xs text-stone-500">
        Permalinks to the full rules. Share the permalink; it forwards to the URL below, so a new version only needs a
        new URL here. Linked from the Standard Ruleset of the listed battle types once a URL is set.
      </p>

      {isLoading && <div className="py-4 text-center text-sm text-stone-400">Loading…</div>}

      {!isLoading && (
        <div className="space-y-4">
          {docs.map((d) => {
            const bad = d.url.trim() !== '' && !/^https?:\/\/\S+$/i.test(d.url.trim());
            return (
              <div key={d.slug} className="rounded border border-stone-800 bg-stone-900/50 p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                  <code className="rounded bg-stone-950 px-2 py-1 text-stone-300">{permalink(d.slug)}</code>
                  <button
                    type="button"
                    onClick={() => void copy(d.slug)}
                    className="rounded border border-stone-700 px-2 py-1 text-stone-400 transition-colors hover:border-stone-500 hover:text-stone-200"
                  >
                    {copied === d.slug ? 'Copied' : 'Copy'}
                  </button>
                  {d.battle_types.length > 0 && (
                    <span className="text-stone-500">· {d.battle_types.map((bt) => BT_LABEL[bt] ?? bt).join(', ')}</span>
                  )}
                </div>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <label className="flex-1 text-xs">
                    <span className="mb-1 block font-semibold uppercase tracking-wide text-rizzotto-gold-500/80">Label</span>
                    <input
                      value={d.label}
                      onChange={(e) => setField(d.slug, 'label')(e.target.value)}
                      className="w-full rounded border border-stone-700 bg-stone-900 px-3 py-1.5 text-sm text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none"
                    />
                  </label>
                  <label className="flex-[2] text-xs">
                    <span className="mb-1 block font-semibold uppercase tracking-wide text-rizzotto-gold-500/80">Forwards to</span>
                    <input
                      value={d.url}
                      placeholder="https://… (empty = not linked yet)"
                      onChange={(e) => setField(d.slug, 'url')(e.target.value)}
                      className={`w-full rounded border bg-stone-900 px-3 py-1.5 text-sm text-stone-200 focus:outline-none ${
                        bad ? 'border-red-500' : 'border-stone-700 focus:border-rizzotto-gold-500'
                      }`}
                    />
                    {bad && <span className="mt-1 block text-red-400">Must start with http:// or https://</span>}
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {saveError && <p className="mt-2 text-xs text-red-400">{(saveError as Error).message}</p>}

      {!isLoading && (
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => mutate()}
            disabled={isPending || invalidUrl}
            className="rounded border border-rizzotto-gold-700 bg-rizzotto-gold-500/10 px-4 py-1.5 text-sm text-rizzotto-gold-400 transition-colors hover:bg-rizzotto-gold-500/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isPending ? 'Saving…' : 'Save documents'}
          </button>
          {saved && <span className="text-xs text-emerald-400">Saved.</span>}
        </div>
      )}
    </div>
  );
}
