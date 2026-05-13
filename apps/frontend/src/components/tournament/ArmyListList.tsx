import { useQuery } from '@tanstack/react-query';
import { formatInUserTimezone } from '@/lib/timezone';

interface ArmyList {
  id: string;
  file_name: string;
  file_type: 'TXT' | 'PDF';
  parsed_data: { lord?: string; units?: string[] } | null;
  created_at: string;
}

export function ArmyListList() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['army-lists', 'me'],
    queryFn: async () => {
      const res = await fetch('/api/army-lists', { credentials: 'include' });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      return res.json() as Promise<{ lists: ArmyList[] }>;
    },
  });

  if (isLoading) return <p className="text-stone-400">Lade Listen…</p>;
  if (isError) return <p className="text-red-400">Fehler beim Laden.</p>;
  if (!data?.lists || data.lists.length === 0) {
    return <p className="text-stone-500 italic">Noch keine Army-Listen hochgeladen.</p>;
  }

  return (
    <ul className="space-y-2">
      {data.lists.map((l) => (
        <li key={l.id} className="rounded border border-stone-700 bg-stone-900/60 p-3 text-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-stone-200">{l.file_name}</p>
              <p className="text-xs text-stone-500">
                {l.file_type} · {formatInUserTimezone(l.created_at)}
                {l.parsed_data?.lord && ` · Lord: ${l.parsed_data.lord}`}
              </p>
            </div>
            <a
              href={`/api/army-lists/${l.id}/download`}
              className="text-xs text-warhammer-gold hover:underline"
            >
              Download
            </a>
          </div>
        </li>
      ))}
    </ul>
  );
}
