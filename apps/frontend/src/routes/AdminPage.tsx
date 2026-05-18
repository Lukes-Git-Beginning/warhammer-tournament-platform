import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthQuery } from '@/lib/auth';
import { AuditLogTable } from '@/components/admin/AuditLogTable';
import { StatsDashboard } from '@/components/admin/StatsDashboard';
import { UserBanTab } from '@/components/admin/UserBanTab';
import { PresetLibraryAdmin } from '@/components/admin/PresetLibraryAdmin';
import { PageShell } from '@/components/layout/PageShell';

type Tab = 'audit' | 'dashboard' | 'users' | 'presets';

export function AdminPage() {
  const { t } = useTranslation();
  const { data: user } = useAuthQuery();
  const [tab, setTab] = useState<Tab>('dashboard');

  const TAB_LABELS: Record<Tab, string> = {
    dashboard: t('admin.tabs.dashboard'),
    audit: t('admin.tabs.audit'),
    users: t('admin.tabs.users'),
    presets: t('admin.tabs.presets'),
  };

  if (!user) {
    return (
      <PageShell variant="narrow" spacing="tight" className="text-rizzotto-stone-400">
        {t('admin.login_required')}
      </PageShell>
    );
  }

  if (user.role !== 'ADMIN') {
    return (
      <PageShell variant="narrow" spacing="tight" className="text-rizzotto-stone-400">
        {t('admin.permission_denied')}
      </PageShell>
    );
  }

  return (
    <PageShell variant="wide" spacing="tight">
      <h1 className="font-display text-3xl font-bold text-rizzotto-gold-500 mb-6">
        {t('admin.title')}
      </h1>

      <nav
        className="flex gap-4 border-b border-rizzotto-iron-700 mb-6"
        aria-label={t('admin.tabs_aria')}
      >
        {(['dashboard', 'audit', 'users', 'presets'] as Tab[]).map((tabKey) => (
          <button
            key={tabKey}
            type="button"
            onClick={() => setTab(tabKey)}
            aria-current={tab === tabKey ? 'page' : undefined}
            className={`px-3 py-2 text-sm transition-colors ${
              tab === tabKey
                ? 'border-b-2 border-rizzotto-gold-500 text-rizzotto-gold-500'
                : 'text-rizzotto-stone-400 hover:text-rizzotto-stone-200'
            }`}
          >
            {TAB_LABELS[tabKey]}
          </button>
        ))}
      </nav>

      <div>
        {tab === 'dashboard' && <StatsDashboard />}
        {tab === 'audit' && <AuditLogTable />}
        {tab === 'users' && <UserBanTab />}
        {tab === 'presets' && <PresetLibraryAdmin />}
      </div>
    </PageShell>
  );
}
