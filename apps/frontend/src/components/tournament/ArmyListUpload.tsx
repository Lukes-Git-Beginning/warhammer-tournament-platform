import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

export interface ArmyList {
  id: string;
  file_name: string;
  file_type: 'TXT' | 'PDF';
  parsed_data: {
    battle_type?: string;
    lord?: string;
    heroes?: string[];
    units?: string[];
  } | null;
  created_at: string;
}

export interface ArmyListUploadProps {
  factionId: string;
  tournamentId?: string;
  onUploadComplete?: (armyList: ArmyList) => void;
}

export function ArmyListUpload({ factionId, tournamentId, onUploadComplete }: ArmyListUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const upload = useMutation({
    mutationFn: async (selectedFile: File): Promise<ArmyList> => {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('faction_id', factionId);
      if (tournamentId) formData.append('tournament_id', tournamentId);

      const res = await fetch('/api/army-lists', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { message?: string }).message ?? `Upload failed: ${res.status}`);
      }
      return res.json() as Promise<ArmyList>;
    },
    onSuccess: (data) => {
      setFile(null);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['army-lists'] });
      onUploadComplete?.(data);
    },
    onError: (err: Error) => setError(err.message),
  });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null;
    setFile(selected);
    setError(null);
  }

  function handleUpload() {
    if (!file) return;
    upload.mutate(file);
  }

  return (
    <div className="rounded border border-stone-700 bg-stone-900/40 p-4">
      <label className="block">
        <span className="text-sm text-stone-300">Army-Liste (TXT oder PDF, max 5 MB)</span>
        <input
          type="file"
          accept=".txt,.pdf,text/plain,application/pdf"
          onChange={handleFileChange}
          className="mt-2 block w-full text-sm text-stone-400 file:mr-3 file:rounded file:border-0 file:bg-stone-800 file:px-3 file:py-1.5 file:text-stone-200 hover:file:bg-stone-700"
        />
      </label>
      {file && (
        <button
          type="button"
          onClick={handleUpload}
          disabled={upload.isPending}
          className="mt-3 rounded bg-warhammer-gold/90 px-4 py-1.5 text-sm font-medium text-stone-950 hover:bg-warhammer-gold disabled:opacity-50"
        >
          {upload.isPending ? 'Lädt hoch…' : 'Hochladen'}
        </button>
      )}
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      {upload.data && (
        <div className="mt-3 rounded border border-stone-700 bg-stone-900 p-3 text-sm">
          <p className="text-stone-300">Hochgeladen: {upload.data.file_name}</p>
          {upload.data.parsed_data?.lord && (
            <p className="text-stone-400">Lord: {upload.data.parsed_data.lord}</p>
          )}
          {upload.data.parsed_data?.units && upload.data.parsed_data.units.length > 0 && (
            <p className="text-stone-400">{upload.data.parsed_data.units.length} Units erkannt</p>
          )}
          {!upload.data.parsed_data && (
            <p className="text-stone-500 italic">
              Datei hochgeladen — kein Parse möglich (PDF oder unstrukturiert).
            </p>
          )}
        </div>
      )}
    </div>
  );
}
