import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, getDevUsers } from '@/lib/api.js';
import { useAuthQuery } from '@/lib/auth.js';

// Fallback list (classic `pnpm db:seed:dummies` accounts) used only if the live query
// of actually-seeded dummies is empty/unavailable.
const DUMMY_USERS = [
  { discordId: 'dummy-01', name: 'Grombrindal' },
  { discordId: 'dummy-02', name: 'Settra' },
  { discordId: 'dummy-03', name: 'Sigvald' },
  { discordId: 'dummy-04', name: 'Teclis' },
  { discordId: 'dummy-05', name: 'Tyrion' },
  { discordId: 'dummy-06', name: 'Malekith' },
  { discordId: 'dummy-07', name: 'Thorgrim' },
  { discordId: 'dummy-08', name: 'Louen' },
];

export function DevLoginPanel() {
  const [collapsed, setCollapsed] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const { data: me } = useAuthQuery();
  const queryClient = useQueryClient();
  // List the dummies that actually exist locally (whatever seed ran); fall back to the classic set.
  const { data: devUsers } = useQuery({ queryKey: ['dev-users'], queryFn: getDevUsers, retry: false, staleTime: 60_000 });
  const list = devUsers?.users?.length
    ? devUsers.users.map((u) => ({ discordId: u.discord_id, name: u.username }))
    : DUMMY_USERS;

  async function loginAs(discordId: string) {
    setLoading(discordId);
    try {
      await apiFetch('/auth/dev-login', {
        method: 'POST',
        body: JSON.stringify({ discordId }),
      });
      await queryClient.invalidateQueries();
      window.location.reload();
    } catch (e) {
      console.error('dev-login failed', e);
      setLoading(null);
    }
  }

  async function logout() {
    setLoading('logout');
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
      await queryClient.invalidateQueries();
      window.location.reload();
    } catch {
      setLoading(null);
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-[9999] select-none font-mono text-xs">
      <div className="rounded border border-rizzotto-gold-600/40 bg-rizzotto-iron-950/95 shadow-lg backdrop-blur-sm">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-rizzotto-gold-400 hover:text-rizzotto-gold-300"
        >
          <span className="text-[10px]">{collapsed ? '▲' : '▼'}</span>
          <span>DEV</span>
          {me && (
            <span className="ml-auto text-rizzotto-stone-400 truncate max-w-[100px]">
              {me.username}
            </span>
          )}
        </button>

        {!collapsed && (
          <div className="border-t border-rizzotto-iron-700 px-2 pb-2 pt-1">
            <p className="mb-1 px-1 text-rizzotto-stone-500">Login as dummy:</p>
            <div className="grid grid-cols-2 gap-1">
              {list.map((u) => (
                <button
                  key={u.discordId}
                  onClick={() => loginAs(u.discordId)}
                  disabled={loading !== null}
                  className="rounded px-2 py-1 text-left text-rizzotto-stone-300 hover:bg-rizzotto-iron-800 hover:text-rizzotto-gold-300 disabled:opacity-40"
                >
                  {loading === u.discordId ? '…' : u.name}
                </button>
              ))}
            </div>
            {me && (
              <button
                onClick={logout}
                disabled={loading !== null}
                className="mt-1 w-full rounded px-2 py-1 text-left text-rizzotto-stone-500 hover:bg-rizzotto-iron-800 hover:text-red-400 disabled:opacity-40"
              >
                {loading === 'logout' ? '…' : 'Logout'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
