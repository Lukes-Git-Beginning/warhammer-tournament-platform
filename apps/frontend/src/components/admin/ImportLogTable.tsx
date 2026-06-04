import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ImportLogEntry, ImportLogListResponse } from '@rizzotto/types';
import { apiFetch } from '@/lib/api.js';
import { formatInUserTimezone } from '@/lib/timezone.js';

const PAGE_SIZE = 20;

function formatDate(iso: string): string {
  return formatInUserTimezone(iso);
}

type StatusVariant = 'success' | 'partial' | 'error' | 'unknown';

function resolveVariant(status: string): StatusVariant {
  if (status === 'success') return 'success';
  if (status === 'partial') return 'partial';
  if (status === 'error') return 'error';
  return 'unknown';
}

const VARIANT_CLASSES: Record<StatusVariant, string> = {
  success: 'bg-emerald-900/60 text-emerald-300 border border-emerald-800',
  partial: 'bg-amber-900/60 text-amber-300 border border-amber-800',
  error: 'bg-red-900/60 text-red-300 border border-red-800',
  unknown: 'bg-stone-800 text-stone-400 border border-stone-700',
};

function StatusBadge({ status }: { status: string }) {
  const variant = resolveVariant(status);
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${VARIANT_CLASSES[variant]}`}
    >
      {status}
    </span>
  );
}

function truncateMessage(msg: string, maxLen = 60): string {
  if (msg.length <= maxLen) return msg;
  return `${msg.slice(0, maxLen)}…`;
}

export function ImportLogTable() {
  const [page, setPage] = useState(1);
  const [source, setSource] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-import-log', page, source],
    queryFn: () =>
      apiFetch<ImportLogListResponse>(
        `/api/admin/import-log?page=${page}&pageSize=${PAGE_SIZE}${source ? `&source=${encodeURIComponent(source)}` : ''}`,
      ),
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const entries: ImportLogEntry[] = data?.entries ?? [];

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <label htmlFor="import-source-filter" className="text-sm text-stone-400">
          Quelle:
        </label>
        <input
          id="import-source-filter"
          type="text"
          value={source}
          onChange={(e) => {
            setPage(1);
            setSource(e.target.value);
          }}
          placeholder="z.B. totaltavern_factions…"
          className="rounded border border-stone-700 bg-stone-900 px-3 py-1.5 text-sm text-stone-200 placeholder:text-stone-600 focus:border-rizzotto-gold-500 focus:outline-none"
        />
      </div>

      {isLoading && (
        <div className="py-8 text-center text-stone-400 text-sm">Wird geladen…</div>
      )}

      {error && (
        <div className="rounded-md border border-red-900 bg-red-950/40 p-4 text-red-300 text-sm">
          Fehler beim Laden des Import-Logs.
        </div>
      )}

      {!isLoading && !error && (
        <>
          <div className="overflow-x-auto rounded-md border border-stone-800">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-stone-800 bg-stone-900/60">
                  <th className="px-4 py-3 text-left font-medium text-stone-400">Quelle</th>
                  <th className="px-4 py-3 text-left font-medium text-stone-400">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-stone-400">Importiert</th>
                  <th className="px-4 py-3 text-left font-medium text-stone-400">Fehler</th>
                  <th className="px-4 py-3 text-left font-medium text-stone-400 whitespace-nowrap">
                    Gestartet
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-stone-400 whitespace-nowrap">
                    Abgeschlossen
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-800/60">
                {entries.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-stone-500">
                      No entries.
                    </td>
                  </tr>
                )}
                {entries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-stone-800/30 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-stone-300 whitespace-nowrap">
                      {entry.source}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={entry.status} />
                    </td>
                    <td className="px-4 py-3 text-stone-300 tabular-nums">
                      {entry.records_imported}
                    </td>
                    <td className="px-4 py-3 text-stone-400 max-w-xs">
                      {entry.error_message ? (
                        <span title={entry.error_message} className="cursor-help">
                          {truncateMessage(entry.error_message)}
                        </span>
                      ) : (
                        <span className="text-stone-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-stone-400 whitespace-nowrap">
                      {formatDate(entry.started_at)}
                    </td>
                    <td className="px-4 py-3 text-stone-400 whitespace-nowrap">
                      {entry.finished_at ? (
                        formatDate(entry.finished_at)
                      ) : (
                        <span className="text-stone-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={() => setPage((p) => p - 1)}
                disabled={page <= 1}
                className="rounded border border-stone-700 px-3 py-1.5 text-stone-300 hover:border-stone-500 hover:text-stone-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                ← Back
              </button>
              <span className="text-stone-500">
                Page {page} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= totalPages}
                className="rounded border border-stone-700 px-3 py-1.5 text-stone-300 hover:border-stone-500 hover:text-stone-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
