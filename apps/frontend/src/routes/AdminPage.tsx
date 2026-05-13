import { useState } from 'react';
import { useAuthQuery } from '@/lib/auth';
import { AuditLogTable } from '@/components/admin/AuditLogTable';
import { StatsDashboard } from '@/components/admin/StatsDashboard';
import { UserBanTab } from '@/components/admin/UserBanTab';
import { PresetLibraryAdmin } from '@/components/admin/PresetLibraryAdmin';

type Tab = 'audit' | 'dashboard' | 'users' | 'presets';

const TAB_LABELS: Record<Tab, string> = {
  dashboard: 'Dashboard',
  audit: 'Audit-Log',
  users: 'User-Verwaltung',
  presets: 'Preset-Library',
};

export function AdminPage() {
  const { data: user } = useAuthQuery();
  const [tab, setTab] = useState<Tab>('dashboard');

  if (!user) {
    return <div className="p-6 text-stone-400">Bitte einloggen.</div>;
  }

  if (user.role !== 'ADMIN') {
    return (
      <div className="p-6 text-stone-400">
        Keine Berechtigung (ADMIN-Rolle erforderlich).
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <h1 className="font-display text-3xl font-bold text-warhammer-gold mb-6">Admin-Panel</h1>

      <nav className="flex gap-4 border-b border-stone-800 mb-6" aria-label="Admin-Tabs">
        {(['dashboard', 'audit', 'users', 'presets'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-current={tab === t ? 'page' : undefined}
            className={`px-3 py-2 text-sm transition-colors ${
              tab === t
                ? 'border-b-2 border-warhammer-gold text-warhammer-gold'
                : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </nav>

      <div>
        {tab === 'dashboard' && <StatsDashboard />}
        {tab === 'audit' && <AuditLogTable />}
        {tab === 'users' && <UserBanTab />}
        {tab === 'presets' && <PresetLibraryAdmin />}
      </div>
    </main>
  );
}
