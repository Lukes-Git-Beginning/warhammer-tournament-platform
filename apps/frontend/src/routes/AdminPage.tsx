import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthQuery } from '@/lib/auth.js';
import { AuditLogTable } from '@/components/admin/AuditLogTable.js';
import { QueueActivityTable } from '@/components/admin/QueueActivityTable.js';
import { StatsDashboard } from '@/components/admin/StatsDashboard.js';
import { UserBanTab } from '@/components/admin/UserBanTab.js';
import { PresetLibraryAdmin } from '@/components/admin/PresetLibraryAdmin.js';
import { FactionWinRatesChart } from '@/components/admin/FactionWinRatesChart.js';
import { DropOffFunnelChart } from '@/components/admin/DropOffFunnelChart.js';
import { PickBanStatsChart } from '@/components/admin/PickBanStatsChart.js';
import { MapPoolEditor } from '@/components/admin/MapPoolEditor.js';
import { FactionManager } from '@/components/admin/FactionManager.js';
import { TournamentDefaultsEditor } from '@/components/admin/TournamentDefaultsEditor.js';
import { FeatureFlagsPanel } from '@/components/admin/FeatureFlagsPanel.js';
import { WelcomeBannerEditor } from '@/components/admin/WelcomeBannerEditor.js';
import { PageShell } from '@/components/layout/PageShell.js';
import { ImportLogTable } from '@/components/admin/ImportLogTable.js';
import { AdminMatchesTab } from '@/components/admin/AdminMatchesTab.js';
import { AdminScheduledMatchupsTab } from '@/components/admin/AdminScheduledMatchupsTab.js';

type Tab = 'audit' | 'dashboard' | 'users' | 'presets' | 'stats' | 'settings' | 'import' | 'matches' | 'challenges' | 'queue';

const ALL_TABS: Tab[] = ['dashboard', 'stats', 'settings', 'users', 'matches', 'challenges', 'queue', 'presets', 'audit', 'import'];

const TAB_LABEL_KEYS: Record<Tab, string> = {
  dashboard: 'admin.tabs.dashboard',
  audit: 'admin.tabs.audit',
  users: 'admin.tabs.users',
  presets: 'admin.tabs.presets',
  stats: 'admin.tabs.stats',
  settings: 'admin.tabs.settings',
  import: 'admin.tabs.import',
  matches: 'admin.tabs.matches',
  challenges: 'admin.tabs.challenges',
  queue: 'admin.tabs.queue',
};

const STATIC_LABELS: Record<Tab, string> = {
  dashboard: 'Dashboard',
  audit: 'Audit Log',
  users: 'Users',
  presets: 'Presets',
  stats: 'Statistics',
  settings: 'Settings',
  import: 'Import-Log',
  matches: 'Matches',
  challenges: 'Challenges',
  queue: 'Queue Activity',
};

function StatsTab() {
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <FactionWinRatesChart />
      <DropOffFunnelChart />
      <PickBanStatsChart />
    </div>
  );
}

function SettingsTab() {
  return (
    <div className="space-y-8">
      {/* Section: Map Pool */}
      <section className="rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-5">
        <MapPoolEditor />
      </section>

      {/* Section: Factions */}
      <section className="rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-5">
        <FactionManager />
      </section>

      {/* Section: Tournament Defaults */}
      <section className="rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-5">
        <TournamentDefaultsEditor />
      </section>

      {/* Section: Feature Flags */}
      <section className="rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-5">
        <FeatureFlagsPanel />
      </section>

      {/* Section: Welcome Banner */}
      <section className="rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-5">
        <WelcomeBannerEditor />
      </section>
    </div>
  );
}

export function AdminPage() {
  const { t } = useTranslation();
  const { data: user } = useAuthQuery();

  // Derive initial tab from search param (for deep-links like /admin?tab=stats)
  const searchParams = new URLSearchParams(
    typeof window !== 'undefined' ? window.location.search : '',
  );
  const initialTab = (searchParams.get('tab') as Tab | null) ?? 'dashboard';
  const [tab, setTab] = useState<Tab>(
    ALL_TABS.includes(initialTab as Tab) ? initialTab : 'dashboard',
  );

  function changeTab(t: Tab) {
    setTab(t);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', t);
    window.history.replaceState({}, '', url.toString());
  }

  function getLabel(tabKey: Tab): string {
    // Try i18n first, fall back to static
    const key = TAB_LABEL_KEYS[tabKey];
    const translated = t(key);
    return translated !== key ? translated : STATIC_LABELS[tabKey];
  }

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
    <PageShell variant="full" spacing="tight">
      <h1 className="font-display text-3xl font-bold text-rizzotto-gold-500 mb-6">
        {t('admin.title') !== 'admin.title' ? t('admin.title') : 'Conclave — Admin'}
      </h1>

      <nav
        className="flex flex-wrap gap-4 border-b border-rizzotto-iron-700 mb-6"
        aria-label="Admin navigation"
      >
        {ALL_TABS.map((tabKey) => (
          <button
            key={tabKey}
            type="button"
            onClick={() => changeTab(tabKey)}
            aria-current={tab === tabKey ? 'page' : undefined}
            className={`px-3 py-2 text-sm transition-colors whitespace-nowrap ${
              tab === tabKey
                ? 'border-b-2 border-rizzotto-gold-500 text-rizzotto-gold-500'
                : 'text-rizzotto-stone-400 hover:text-rizzotto-stone-200'
            }`}
          >
            {getLabel(tabKey)}
          </button>
        ))}
      </nav>

      <div>
        {tab === 'dashboard' && <StatsDashboard />}
        {tab === 'audit' && <AuditLogTable />}
        {tab === 'users' && <UserBanTab />}
        {tab === 'matches' && <AdminMatchesTab />}
        {tab === 'challenges' && <AdminScheduledMatchupsTab />}
        {tab === 'queue' && <QueueActivityTable />}
        {tab === 'presets' && <PresetLibraryAdmin />}
        {tab === 'stats' && <StatsTab />}
        {tab === 'settings' && <SettingsTab />}
        {tab === 'import' && <ImportLogTable />}
      </div>
    </PageShell>
  );
}
