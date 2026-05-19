import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import { getAdminConfig, putAdminConfig } from '@/lib/api.js';

const CONFIG_KEY = 'welcome_banner_text';

export function WelcomeBannerEditor() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-config', CONFIG_KEY],
    queryFn: () => getAdminConfig(CONFIG_KEY),
    retry: false,
  });

  const [markdown, setMarkdown] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data?.value && typeof data.value === 'string') {
      setMarkdown(data.value);
    }
  }, [data]);

  const { mutate, isPending, error: saveError } = useMutation({
    mutationFn: () => putAdminConfig(CONFIG_KEY, markdown),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  return (
    <div>
      <h3 className="font-display text-base font-semibold text-rizzotto-gold-400 mb-4">
        Welcome Banner
      </h3>

      {isLoading && (
        <div className="py-4 text-center text-stone-400 text-sm">Loading…</div>
      )}

      {error && (
        <div className="rounded border border-amber-900 bg-amber-950/40 p-3 text-amber-300 text-xs mb-4">
          Config not found. Start typing to create.
        </div>
      )}

      {!isLoading && (
        <div className="flex flex-col gap-4 lg:flex-row">
          {/* Editor */}
          <div className="flex-1">
            <p className="mb-1 text-xs text-stone-500">Markdown source</p>
            <textarea
              rows={12}
              value={markdown}
              onChange={(e) => { setMarkdown(e.target.value); setSaved(false); }}
              placeholder="*Karaz Ankor* — **Where Lists Are Forged**…"
              className="w-full resize-y rounded border border-stone-700 bg-stone-900 px-3 py-2 font-mono text-xs text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none"
            />
          </div>

          {/* Preview */}
          <div className="flex-1">
            <p className="mb-1 text-xs text-stone-500">Live preview</p>
            <div className="min-h-[12rem] rounded border border-stone-700 bg-stone-900/60 px-4 py-3 prose prose-invert prose-sm max-w-none text-stone-300 text-xs leading-relaxed">
              {markdown ? (
                <ReactMarkdown>{markdown}</ReactMarkdown>
              ) : (
                <span className="text-stone-600 italic">Preview will appear here…</span>
              )}
            </div>
          </div>
        </div>
      )}

      {saveError && (
        <p className="mt-2 text-xs text-red-400">{(saveError as Error).message}</p>
      )}

      {!isLoading && (
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => mutate()}
            disabled={isPending}
            className="rounded border border-rizzotto-gold-700 bg-rizzotto-gold-500/10 px-4 py-1.5 text-sm text-rizzotto-gold-400 hover:bg-rizzotto-gold-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isPending ? 'Saving…' : 'Save'}
          </button>
          {saved && <span className="text-xs text-emerald-400">Saved.</span>}
          <span className="ml-auto text-xs text-stone-600">
            {markdown.length} chars
          </span>
        </div>
      )}
    </div>
  );
}
