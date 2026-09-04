import { useEffect, useRef, useState } from 'react';

/**
 * Deferred poster picker for the create form. The tournament does not exist yet,
 * so we cannot use the multipart upload endpoint here — this control just holds
 * the chosen File in the parent's state and renders a local preview. The create
 * form uploads it via uploadTournamentPoster() once the new slug is known.
 */
export function PosterPickField({
  file,
  onPick,
}: {
  file: File | null;
  onPick: (file: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <fieldset className="space-y-3 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
      <legend className="px-1 text-sm font-semibold text-rizzotto-stone-200">
        Poster <span className="text-rizzotto-stone-600">(optional)</span>
      </legend>
      {preview ? (
        <img
          src={preview}
          alt="Tournament poster preview"
          className="aspect-[10/3] w-full rounded border border-stone-800 object-cover"
        />
      ) : (
        <p className="text-sm text-rizzotto-stone-500">
          No poster set. Upload a banner image — shown on the tournament page and its card.
        </p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/avif"
        className="hidden"
        onChange={(e) => {
          const chosen = e.target.files?.[0];
          if (chosen) onPick(chosen);
          e.target.value = '';
        }}
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="rounded border border-rizzotto-iron-600 px-3 py-1.5 text-sm text-rizzotto-stone-200 transition-colors hover:border-rizzotto-gold-500 hover:text-rizzotto-gold-400"
        >
          {preview ? 'Replace poster' : 'Upload poster'}
        </button>
        {preview && (
          <button
            type="button"
            onClick={() => onPick(null)}
            className="text-xs text-rizzotto-stone-500 transition-colors hover:text-red-400"
          >
            Remove
          </button>
        )}
        <span className="text-xs text-rizzotto-stone-500">PNG, JPEG, WebP or AVIF · max 5 MB</span>
      </div>
    </fieldset>
  );
}
