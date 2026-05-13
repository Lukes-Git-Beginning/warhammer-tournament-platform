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
    enabled: search.length >= 2,
  });

  const users = data?.users ?? [];

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <label htmlFor="user-search" className="text-sm text-stone-400">
          Suche:
        </label>
        <input
          id="user-search"
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Username oder Discord-ID (min. 2 Zeichen)"
          className="w-full max-w-sm rounded border border-stone-700 bg-stone-900 px-3 py-1.5 text-sm text-stone-200 placeholder:text-stone-600 focus:border-warhammer-gold focus:outline-none"
        />
      </div>

      {search.length > 0 && search.length < 2 && (
        <p className="text-xs text-stone-500">Mindestens 2 Zeichen eingeben.</p>
      )}

      {isLoading && (
        <div className="py-4 text-center text-stone-400 text-sm">Wird geladen…</div>
      )}

      {error && (
        <div className="rounded-md border border-red-900 bg-red-950/40 p-4 text-red-300 text-sm">
          Fehler beim Laden der User.
        </div>
      )}

      {!isLoading && !error && users.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-stone-800">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-stone-800 bg-stone-900/60">
                <th className="px-4 py-3 text-left font-medium text-stone-400">Username</th>
                <th className="px-4 py-3 text-left font-medium text-stone-400">Role</th>
                <th className="px-4 py-3 text-left font-medium text-stone-400">Status</th>
                <th className="px-4 py-3 text-left font-medium text-stone-400">Aktion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-800/60">
              {users.map((user) => (
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
                  <td className="px-4 py-3">
                    {user.is_banned ? (
                      <span className="rounded bg-red-900/50 px-2 py-0.5 text-xs font-medium text-red-300">
                        Gebannt
                      </span>
                    ) : (
                      <span className="rounded bg-emerald-900/40 px-2 py-0.5 text-xs font-medium text-emerald-300">
                        Aktiv
                      </span>
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
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && !error && search.length >= 2 && users.length === 0 && (
        <p className="py-4 text-center text-stone-500 text-sm">Keine User gefunden.</p>
      )}

      {selectedUser && (
        <UserBanModal
          user={selectedUser}
          onClose={() => setSelectedUser(null)}
        />
      )}
    </div>
  );
}
