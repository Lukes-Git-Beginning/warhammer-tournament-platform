import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { uploadTournamentPoster } from '@/lib/api';

/**
 * Poster upload control for an edit page. Uses a dedicated multipart endpoint
 * (POST /api/tournaments/:slug/poster by default; pass uploadFn for series etc.)
 * rather than the main form save.
 */
export function PosterUploadField({
  slug,
  posterUrl,
  uploadFn = uploadTournamentPoster,
  legend = 'Poster',
  description = 'No poster set. Upload a banner image — shown on the tournament page and its card.',
  onUploaded,
}: {
  slug: string;
  posterUrl?: string | null;
  /** Upload endpoint wrapper. Defaults to the tournament poster endpoint. */
  uploadFn?: (slug: string, file: File) => Promise<{ poster_url: string }>;
  /** Field heading (e.g. "Series Poster"). */
  legend?: string;
  /** Empty-state helper text. */
  description?: string;
  /** Called after a successful upload — use to invalidate the owning query. Defaults to invalidating ['tournament', slug]. */
  onUploaded?: (posterUrl: string) => void;
}) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(posterUrl ?? null);

  const upload = useMutation({
    mutationFn: (file: File) => uploadFn(slug, file),
    onSuccess: (res) => {
      setPreview(res.poster_url);
      if (onUploaded) onUploaded(res.poster_url);
      else void qc.invalidateQueries({ queryKey: ['tournament', slug] });
    },
  });

  return (
    <fieldset className="space-y-3 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
      <legend className="px-1 text-sm font-semibold text-rizzotto-stone-200">{legend}</legend>
      {preview ? (
        <img
          src={preview}
          alt={legend}
          className="aspect-[10/3] w-full rounded border border-stone-800 object-cover"
        />
      ) : (
        <p className="text-sm text-rizzotto-stone-500">{description}</p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/avif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload.mutate(file);
          e.target.value = '';
        }}
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={upload.isPending}
          className="rounded border border-rizzotto-iron-600 px-3 py-1.5 text-sm text-rizzotto-stone-200 transition-colors hover:border-rizzotto-gold-500 hover:text-rizzotto-gold-400 disabled:opacity-50"
        >
          {upload.isPending ? 'Uploading…' : preview ? 'Replace poster' : 'Upload poster'}
        </button>
        <span className="text-xs text-rizzotto-stone-500">PNG, JPEG, WebP or AVIF · max 5 MB</span>
      </div>
      {upload.error && <p className="text-xs text-red-400">{(upload.error as Error).message}</p>}
    </fieldset>
  );
}
