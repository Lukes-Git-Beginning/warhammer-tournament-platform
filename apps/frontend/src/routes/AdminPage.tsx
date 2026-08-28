import { useNavigate, useSearch } from '@tanstack/react-router';
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
import { SkillDistributionChart } from '@/components/admin/SkillDistributionChart.js';
import { UsageOverTimeChart } from '@/components/admin/UsageOverTimeChart.js';
import { MapPoolEditor } from '@/components/admin/MapPoolEditor.js';
import { FactionManager } from '@/components/admin/FactionManager.js';
import { TournamentDefaultsEditor } from '@/components/admin/TournamentDefaultsEditor.js';
import { FeatureFlagsPanel } from '@/components/admin/FeatureFlagsPanel.js';
import { WelcomeBannerEditor } from '@/components/admin/WelcomeBannerEditor.js';
import { StandardRulesetEditor } from '@/components/admin/StandardRulesetEditor.js';
import { PageShell } from '@/components/layout/PageShell.js';
import { ImportLogTable } from '@/components/admin/ImportLogTable.js';
import { AdminMatchesTab } from '@/components/admin/AdminMatchesTab.js';
import { AdminAllGamesTab } from '@/components/admin/AdminAllGamesTab.js';
import { SkillCalibrationTab } from '@/components/admin/SkillCalibrationTab.js';
import { AdminReportsTab } from '@/components/admin/AdminReportsTab.js';
import { AdminSupportersTab } from '@/components/admin/AdminSupportersTab.js';
import { TournamentLogTab } from '@/components/admin/TournamentLogTab.js';

type Tab = 'audit' | 'dashboard' | 'users' | 'supporters' | 'presets' | 'stats' | 'settings' | 'import' | 'matches' | 'all_games' | 'tournament_log' | 'queue' | 'skill_calibration' | 'reports';

const ALL_TABS: Tab[] = ['dashboard', 'stats', 'reports', 'settings', 'skill_calibration', 'users', 'supporters', 'matches', 'all_games', 'tournament_log', 'queue', 'presets', 'audit', 'import'];

const TAB_LABEL_KEYS: Record<Tab, string> = {
  dashboard: 'admin.tabs.dashboard',
  audit: 'admin.tabs.audit',
  users: 'admin.tabs.users',
  supporters: 'admin.tabs.supporters',
  presets: 'admin.tabs.presets',
  stats: 'admin.tabs.stats',
  settings: 'admin.tabs.settings',
  import: 'admin.tabs.import',
  matches: 'admin.tabs.matches',
  all_games: 'admin.tabs.all_games',
  tournament_log: 'admin.tabs.tournament_log',
  queue: 'admin.tabs.queue',
  skill_calibration: 'admin.tabs.skill_calibration',
  reports: 'admin.tabs.reports',
};

const STATIC_LABELS: Record<Tab, string> = {
  dashboard: 'Dashboard',
  audit: 'Audit Log',
  users: 'Users',
  supporters: 'Supporters',
  presets: 'Presets',
  stats: 'Statistics',
  settings: 'Settings',
  import: 'Import-Log',
  matches: 'Matches',
  all_games: 'All Games',
  tournament_log: 'Tournament Log',
  queue: 'Queue Activity',
  skill_calibration: 'Skill Calibration',
  reports: 'Reports',
};

function StatsTab() {
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <UsageOverTimeChart />
      <SkillDistributionChart />
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

      {/* Section: Standard Ruleset */}
      <section className="rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-5">
        <StandardRulesetEditor />
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

  // Tab is fully URL-driven (?tab=…) so it is deep-linkable, survives the browser
  // back/forward buttons, and re-clicking "Admin" in the navbar resets to the dashboard.
  const search = useSearch({ from: '/admin' });
  const navigate = useNavigate({ from: '/admin' });
  const tab: Tab = ALL_TABS.includes(search.tab as Tab) ? (search.tab as Tab) : 'dashboard';

  function changeTab(t: Tab) {
    void navigate({ search: { tab: t } });
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
        {tab === 'supporters' && <AdminSupportersTab />}
        {tab === 'matches' && <AdminMatchesTab />}
        {tab === 'all_games' && <AdminAllGamesTab />}
        {tab === 'tournament_log' && <TournamentLogTab />}
        {tab === 'queue' && <QueueActivityTable />}
        {tab === 'presets' && <PresetLibraryAdmin />}
        {tab === 'stats' && <StatsTab />}
        {tab === 'settings' && <SettingsTab />}
        {tab === 'import' && <ImportLogTable />}
        {tab === 'skill_calibration' && <SkillCalibrationTab />}
        {tab === 'reports' && <AdminReportsTab />}
      </div>
    </PageShell>
  );
}
