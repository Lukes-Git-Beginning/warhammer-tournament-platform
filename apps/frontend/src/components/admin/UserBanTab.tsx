import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { searchUsers, type AdminUser } from '@/lib/api';
import { UserBanModal } from './UserBanModal';

export function UserBanTab() {
  const [search, setSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-users', search],
    queryFn: () => searchUsers(search),
  });

  const users = data?.users ?? [];
  const filtered = search.length >= 2
    ? users
    : users;

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
                <th className="px-4 py-3 text-left font-medium text-stone-400">Member</th>
                <th className="px-4 py-3 text-left font-medium text-stone-400">Role</th>
                <th className="px-4 py-3 text-left font-medium text-stone-400">Joined</th>
                <th className="px-4 py-3 text-left font-medium text-stone-400">Status</th>
                <th className="px-4 py-3 text-left font-medium text-stone-400">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-800/60">
              {filtered.map((user) => (
                <tr key={user.id} className="hover:bg-stone-800/30 transition-colors">
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-2">
                      {user.avatar_url ? (
                        <img
                          src={user.avatar_url}
                          alt={user.username}
                          className="h-7 w-7 rounded-full border border-stone-700 object-cover"
                        />
                      ) : (
                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-stone-700 text-xs font-medium text-stone-200">
                          {user.username[0]?.toUpperCase() ?? '?'}
                        </span>
                      )}
                      <span className="text-stone-200">{user.username}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-stone-400">{user.role}</td>
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
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-stone-500">No members found.</td>
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
