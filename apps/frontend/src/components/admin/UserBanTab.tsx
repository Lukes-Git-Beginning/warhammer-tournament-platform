import { useState, useCallback } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { searchUsers, updateUserRole, type AdminUser } from '@/lib/api';
import { UserBanModal } from './UserBanModal';

const ASSIGNABLE_ROLES = ['USER', 'HOST', 'MODERATOR', 'ADMIN'] as const;

function RoleSelect({ user }: { user: AdminUser }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (role: string) => updateUserRole(user.id, role),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  return (
    <select
      value={user.role === 'ORGANIZER' ? 'ORGANIZER' : user.role}
      disabled={mutation.isPending}
      onChange={(e) => mutation.mutate(e.target.value)}
      className="rounded border border-stone-700 bg-stone-900 px-2 py-0.5 text-xs text-stone-300 focus:border-rizzotto-gold-500 focus:outline-none disabled:opacity-50"
    >
      {user.role === 'ORGANIZER' && (
        <option value="ORGANIZER" disabled>ORGANIZER (legacy)</option>
      )}
      {ASSIGNABLE_ROLES.map((r) => (
        <option key={r} value={r}>{r}</option>
      ))}
    </select>
  );
}

type SortCol = 'username' | 'created_at' | 'role' | 'is_banned';

function SortTh({
  col, label, sortBy, sortDir, onSort,
}: {
  col: SortCol; label: string;
  sortBy: SortCol; sortDir: 'asc' | 'desc';
  onSort: (col: SortCol) => void;
}) {
  const active = sortBy === col;
  return (
    <th
      className="px-4 py-3 text-left font-medium text-stone-400 cursor-pointer select-none hover:text-rizzotto-gold-400 transition-colors whitespace-nowrap"
      onClick={() => onSort(col)}
    >
      {label}
      <span className="ml-1 text-[10px]">
        {active ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
      </span>
    </th>
  );
}

function CopyIdButton({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    void navigator.clipboard.writeText(id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [id]);
  return (
    <button
      type="button"
      onClick={copy}
      title={id}
      className="font-mono text-xs text-stone-500 hover:text-rizzotto-gold-400 transition-colors text-left"
    >
      {copied ? <span className="text-emerald-400">copied!</span> : `${id.slice(0, 8)}…`}
    </button>
  );
}

export function UserBanTab() {
  const [search, setSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [sortBy, setSortBy] = useState<SortCol>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  function handleSort(col: SortCol) {
    if (col === sortBy) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortDir('asc');
    }
  }

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-users', search, sortBy, sortDir],
    queryFn: () => searchUsers(search, sortBy, sortDir),
  });

  const users = data?.users ?? [];

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <input
          id="user-search"
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by username or Discord ID…"
          className="w-full max-w-sm rounded border border-stone-700 bg-stone-900 px-3 py-1.5 text-sm text-stone-200 placeholder:text-stone-500 focus:border-rizzotto-gold-500 focus:outline-none"
        />
        {data && (
          <span className="text-xs text-rizzotto-stone-400">{data.total ?? users.length} members</span>
        )}
      </div>

      {isLoading && <div className="py-8 text-center text-rizzotto-stone-400 text-sm">Loading…</div>}

      {error && (
        <div className="rounded-md border border-red-900 bg-red-950/40 p-4 text-red-300 text-sm">
          Failed to load members.
        </div>
      )}

      {!isLoading && !error && (
        <div className="overflow-x-auto rounded-md border border-stone-800">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-stone-800 bg-stone-900/60">
                <SortTh col="username" label="Member" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                <th className="px-4 py-3 text-left font-medium text-stone-400">User ID</th>
                <th className="px-4 py-3 text-left font-medium text-stone-400">Discord ID</th>
                <th className="px-4 py-3 text-left font-medium text-stone-400">Steam ID</th>
                <SortTh col="role" label="Role" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                <SortTh col="created_at" label="Joined" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                <SortTh col="is_banned" label="Status" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                <th className="px-4 py-3 text-left font-medium text-stone-400">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-800/60">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-stone-800/30 transition-colors">
                  <td className="px-4 py-3">
                    <Link
                      to="/users/$id"
                      params={{ id: user.id }}
                      className="flex items-center gap-2 hover:underline decoration-rizzotto-stone-500"
                    >
                      {user.avatar_url ? (
                        <img
                          src={user.avatar_url}
                          alt={user.username}
                          className="h-7 w-7 rounded-full border border-stone-700 object-cover shrink-0"
                        />
                      ) : (
                        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-stone-700 text-xs font-medium text-stone-200">
                          {user.username[0]?.toUpperCase() ?? '?'}
                        </span>
                      )}
                      <span className="text-rizzotto-stone-200">{user.username}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-3"><CopyIdButton id={user.id} /></td>
                  <td className="px-4 py-3 font-mono text-xs text-stone-400 select-all">{user.discord_id}</td>
                  <td className="px-4 py-3 font-mono text-xs text-stone-400 select-all">
                    {user.steam_id ?? <span className="text-stone-600 not-italic">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <RoleSelect user={user} />
                  </td>
                  <td className="px-4 py-3 text-stone-500 text-xs">
                    {new Date(user.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </td>
                  <td className="px-4 py-3">
                    {user.is_banned ? (
                      <span className="rounded bg-red-900/50 px-2 py-0.5 text-xs font-medium text-red-300">Banned</span>
                    ) : (
                      <span className="rounded bg-emerald-900/40 px-2 py-0.5 text-xs font-medium text-emerald-300">Active</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setSelectedUser(user)}
                      className={`rounded px-3 py-1 text-xs font-semibold transition-colors ${
                        user.is_banned
                          ? 'border border-emerald-700 text-emerald-300 hover:bg-emerald-900/30'
                          : 'border border-red-700 text-red-300 hover:bg-red-900/30'
                      }`}
                    >
                      {user.is_banned ? 'Unban' : 'Ban'}
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-stone-500">No members found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {selectedUser && <UserBanModal user={selectedUser} onClose={() => setSelectedUser(null)} />}
    </div>
  );
}
