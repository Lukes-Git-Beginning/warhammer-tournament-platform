import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAccessLog, adminSearchUsers, type AccessEventType } from '@/lib/api';

const TYPE_LABEL: Record<AccessEventType, string> = { LOGIN: 'Login', VISIT: 'Visit', PAGE_VIEW: 'Page' };
const TYPE_BADGE: Record<AccessEventType, string> = {
  LOGIN: 'bg-emerald-900/60 text-emerald-300',
  VISIT: 'bg-sky-900/60 text-sky-300',
  PAGE_VIEW: 'bg-stone-800 text-stone-300',
};

const PAGE_SIZE = 50;

export function AccessLogTab() {
  const [type, setType] = useState<AccessEventType | ''>('');
  const [userFilter, setUserFilter] = useState<{ id: string; username: string } | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['access-log', page, type, userFilter?.id],
    queryFn: () =>
      getAccessLog({ page, pageSize: PAGE_SIZE, type: type || undefined, user_id: userFilter?.id }),
  });

  const { data: searchResults } = useQuery({
    queryKey: ['access-log-user-search', search],
    queryFn: () => adminSearchUsers(search, 8),
    enabled: search.trim().length >= 2,
  });

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const focusUser = (u: { id: string; username: string }) => {
    setUserFilter(u);
    setSearch('');
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-stone-100">Access log</h2>
        <p className="text-xs text-stone-500">
          Login, visit and page-view history (kept 90 days). Click a name to focus a single user.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={type}
          onChange={(e) => {
            setType(e.target.value as AccessEventType | '');
            setPage(1);
          }}
          className="rounded border border-stone-700 bg-stone-900 px-2 py-1.5 text-sm text-stone-200"
        >
          <option value="">All types</option>
          <option value="LOGIN">Logins</option>
          <option value="VISIT">Visits</option>
          <option value="PAGE_VIEW">Page views</option>
        </select>

        {userFilter ? (
          <span className="inline-flex items-center gap-2 rounded border border-rizzotto-gold-700/50 bg-rizzotto-gold-900/20 px-2 py-1 text-sm text-rizzotto-gold-300">
            {userFilter.username}
            <button
              type="button"
              onClick={() => {
                setUserFilter(null);
                setPage(1);
              }}
              className="text-stone-400 hover:text-stone-200"
            >
              ×
            </button>
          </span>
        ) : (
          <div className="relative">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by user…"
              className="w-48 rounded border border-stone-700 bg-stone-900 px-2 py-1.5 text-sm text-stone-200 placeholder:text-stone-600"
            />
            {searchResults && searchResults.users.length > 0 && search.trim().length >= 2 && (
              <div className="absolute z-10 mt-1 w-56 rounded border border-stone-700 bg-stone-950 shadow-lg">
                {searchResults.users.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => focusUser({ id: u.id, username: u.username })}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm text-stone-300 hover:bg-stone-800"
                  >
                    {u.avatar_url && <img src={u.avatar_url} alt="" className="h-5 w-5 rounded-full" />}
                    {u.username}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-stone-500">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-stone-500">No entries.</p>
      ) : (
        <div className="overflow-x-auto rounded border border-stone-800">
          <table className="w-full text-sm">
            <thead className="bg-stone-900/60 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Page</th>
                <th className="px-3 py-2">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-800/60">
              {entries.map((e) => {
                const u = e.user;
                return (
                  <tr key={e.id} className="text-stone-300">
                    <td className="whitespace-nowrap px-3 py-1.5 text-stone-400">
                      {new Date(e.created_at).toLocaleString('en-GB', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="px-3 py-1.5">
                      {u ? (
                        <button
                          type="button"
                          onClick={() => focusUser({ id: u.id, username: u.username })}
                          className="flex items-center gap-2 hover:text-rizzotto-gold-300"
                        >
                          {u.avatar_url && <img src={u.avatar_url} alt="" className="h-5 w-5 rounded-full" />}
                          {u.username}
                        </button>
                      ) : (
                        <span className="text-stone-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${TYPE_BADGE[e.type]}`}>
                        {TYPE_LABEL[e.type]}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-stone-400" title={e.path ?? ''}>
                      {e.page ?? e.path ?? '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs text-stone-500">
                      {e.ip ?? '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-stone-500">
        <span>{total} entries</span>
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
