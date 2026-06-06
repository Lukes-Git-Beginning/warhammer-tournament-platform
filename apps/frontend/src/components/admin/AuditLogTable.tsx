import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAdminAuditLog, type AuditLogEntry } from '@/lib/api';
import { formatInUserTimezone } from '@/lib/timezone';

const PAGE_SIZE = 20;

function formatDate(iso: string): string {
  return formatInUserTimezone(iso);
}

function truncate(str: string, maxLen = 12): string {
  if (str.length <= maxLen) return str;
  return `${str.slice(0, 8)}…`;
}

function ActorCell({ entry }: { entry: AuditLogEntry }) {
  const name = entry.actor_username ?? entry.actor_id.slice(0, 8);
  if (entry.actor_avatar_url) {
    return (
      <span className="flex items-center gap-2">
        <img
          src={entry.actor_avatar_url}
          alt={name}
          className="h-6 w-6 rounded-full border border-stone-700 object-cover"
        />
        <span className="text-stone-200">{name}</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-stone-700 text-xs font-medium text-stone-200">
        {name[0]?.toUpperCase() ?? '?'}
      </span>
      <span className="text-stone-200">{name}</span>
    </span>
  );
}

export function AuditLogTable() {
  const [page, setPage] = useState(1);
  const [entityTypeFilter, setEntityTypeFilter] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-audit-log', page, entityTypeFilter],
    queryFn: () =>
      getAdminAuditLog({
        page,
        pageSize: PAGE_SIZE,
        entity_type: entityTypeFilter || undefined,
      }),
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const entries = data?.entries ?? [];

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <label htmlFor="entity-type-filter" className="text-sm text-stone-400">
          Entity type:
        </label>
        <input
          id="entity-type-filter"
          type="text"
          value={entityTypeFilter}
          onChange={(e) => {
            setPage(1);
            setEntityTypeFilter(e.target.value);
          }}
          placeholder="e.g. Match, Tournament…"
          className="rounded border border-stone-700 bg-stone-900 px-3 py-1.5 text-sm text-stone-200 placeholder:text-stone-600 focus:border-rizzotto-gold-500 focus:outline-none"
        />
      </div>

      {isLoading && <div className="py-8 text-center text-stone-400 text-sm">Loading…</div>}

      {error && (
        <div className="rounded-md border border-red-900 bg-red-950/40 p-4 text-red-300 text-sm">
          Failed to load audit log.
        </div>
      )}

      {!isLoading && !error && (
        <>
          <div className="overflow-x-auto rounded-md border border-stone-800">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-stone-800 bg-stone-900/60">
                  <th className="px-4 py-3 text-left font-medium text-stone-400">Date</th>
                  <th className="px-4 py-3 text-left font-medium text-stone-400">Entity Type</th>
                  <th className="px-4 py-3 text-left font-medium text-stone-400">Entity ID</th>
                  <th className="px-4 py-3 text-left font-medium text-stone-400">Action</th>
                  <th className="px-4 py-3 text-left font-medium text-stone-400">Actor</th>
                  <th className="px-4 py-3 text-left font-medium text-stone-400">Details</th>
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
                {entries.map((entry) => {
                  const newVal = entry.new_value as Record<string, unknown> | null;
                  const reason = typeof newVal?.reason === 'string' ? newVal.reason : null;
                  const result = typeof newVal?.result === 'string' ? newVal.result : null;
                  return (
                    <tr key={entry.id} className="hover:bg-stone-800/30 transition-colors">
                      <td className="px-4 py-3 text-stone-400 whitespace-nowrap">
                        {formatDate(entry.created_at)}
                      </td>
                      <td className="px-4 py-3 text-stone-300">{entry.entity_type}</td>
                      <td className="px-4 py-3 font-mono text-xs text-stone-400">
                        {truncate(entry.entity_id)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded bg-stone-800 px-2 py-0.5 text-xs font-medium text-rizzotto-gold-500">
                          {entry.action}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <ActorCell entry={entry} />
                      </td>
                      <td className="px-4 py-3 text-stone-400 text-xs max-w-xs">
                        {reason && (
                          <span className="text-amber-400" title={reason}>
                            {reason.length > 60 ? `${reason.slice(0, 60)}…` : reason}
                          </span>
                        )}
                        {result && !reason && (
                          <span className="text-stone-500">{result}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
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
