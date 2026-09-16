import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getBotMessages, type BotMessageStatus } from '@/lib/api';

const PAGE_SIZE = 50;

const STATUS_BADGE: Record<BotMessageStatus, string> = {
  SENT:    'bg-emerald-900/60 text-emerald-300',
  FAILED:  'bg-red-900/60 text-red-300',
  SKIPPED: 'bg-amber-900/60 text-amber-300',
};

const TARGET_BADGE: Record<'DM' | 'CHANNEL', string> = {
  DM:      'bg-sky-900/60 text-sky-300',
  CHANNEL: 'bg-purple-900/60 text-purple-300',
};

/** Debounce a value by `ms` to avoid a query per keystroke while typing. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function BotMessagesTab() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<BotMessageStatus | ''>('');
  const [targetId, setTargetId] = useState('');
  const [contentSearch, setContentSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const debouncedTarget = useDebounced(targetId, 400);
  const debouncedQ      = useDebounced(contentSearch, 400);

  // Reset to page 1 whenever filters change.
  useEffect(() => { setPage(1); }, [status, debouncedTarget, debouncedQ]);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-bot-messages', page, status, debouncedTarget, debouncedQ],
    queryFn: () =>
      getBotMessages({
        page,
        limit: PAGE_SIZE,
        status: status || undefined,
        target_id: debouncedTarget || undefined,
        q: debouncedQ || undefined,
      }),
  });

  const rows      = data?.data ?? [];
  const total     = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-stone-100">Bot Messages</h2>
        <p className="text-xs text-stone-500">
          All Discord DMs and channel messages dispatched by the bot (kept 60 days). Click a row to
          expand the full message content.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as BotMessageStatus | '')}
          className="rounded border border-stone-700 bg-stone-900 px-2 py-1.5 text-sm text-stone-200"
        >
          <option value="">All statuses</option>
          <option value="SENT">Sent</option>
          <option value="FAILED">Failed</option>
          <option value="SKIPPED">Skipped</option>
        </select>

        <input
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
          placeholder="Discord / channel ID…"
          className="w-48 rounded border border-stone-700 bg-stone-900 px-2 py-1.5 text-sm text-stone-200 placeholder:text-stone-600"
        />

        <div className="relative">
          <input
            value={contentSearch}
            onChange={(e) => setContentSearch(e.target.value)}
            placeholder="Search content…"
            className="w-52 rounded border border-stone-700 bg-stone-900 px-2 py-1.5 text-sm text-stone-200 placeholder:text-stone-600"
          />
          {contentSearch && (
            <button
              type="button"
              onClick={() => setContentSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-stone-500 hover:text-stone-300"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-stone-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-stone-500">No bot messages found.</p>
      ) : (
        <div className="overflow-x-auto rounded border border-stone-800">
          <table className="w-full text-sm">
            <thead className="bg-stone-900/60 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Recipient</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2">Content preview</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-800/60">
              {rows.map((row) => {
                const isExpanded = expandedId === row.id;
                return (
                  <>
                    <tr
                      key={row.id}
                      onClick={() => setExpandedId(isExpanded ? null : row.id)}
                      className="cursor-pointer text-stone-300 hover:bg-stone-800/40 transition-colors"
                    >
                      <td className="whitespace-nowrap px-3 py-1.5 text-stone-400">
                        {new Date(row.created_at).toLocaleString('en-GB', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="px-3 py-1.5">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                            TARGET_BADGE[row.target_type as 'DM' | 'CHANNEL'] ?? 'bg-stone-800 text-stone-300'
                          }`}
                        >
                          {row.target_type}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-stone-300 text-xs">
                        {row.recipient_username ? (
                          <span className="font-medium">{row.recipient_username}</span>
                        ) : (
                          <span className="font-mono text-stone-500 text-[11px]">{row.target_id}</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                            STATUS_BADGE[row.status as BotMessageStatus] ?? 'bg-stone-800 text-stone-300'
                          }`}
                        >
                          {row.status}
                        </span>
                        {row.detail && row.status !== 'SENT' && (
                          <span className="ml-1 font-mono text-[10px] text-stone-500">{row.detail}</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-stone-500 text-xs">
                        {row.kind ?? <span className="text-stone-600">—</span>}
                      </td>
                      <td className="max-w-[28rem] px-3 py-1.5 text-stone-400 text-xs truncate" title={row.content}>
                        {row.content.slice(0, 120)}{row.content.length > 120 ? '…' : ''}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${row.id}-expanded`}>
                        <td
                          colSpan={6}
                          className="bg-stone-900/60 px-4 py-3"
                        >
                          <pre className="whitespace-pre-wrap break-words font-mono text-xs text-stone-300">
                            {row.content}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-stone-500">
        <span>{total} messages</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded border border-stone-700 px-2 py-1 disabled:opacity-40"
          >
            Prev
          </button>
          <span>
            Page {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded border border-stone-700 px-2 py-1 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
