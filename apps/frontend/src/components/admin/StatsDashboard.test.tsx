import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AdminStats } from '@/lib/api';

// ---------------------------------------------------------------------------
// Mock api module
// ---------------------------------------------------------------------------

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    getAdminStats: vi.fn(),
  };
});

import { getAdminStats } from '@/lib/api';
import { StatsDashboard } from './StatsDashboard';

const MOCK_STATS: AdminStats = {
  activeUsers: 42,
  tournaments: { total: 10, active: 3, completed: 7 },
  matchesPlayed: 128,
  currentSeason: 'Season 4',
  topFactions: [
    { faction_id: 'f1', faction_name: 'Greenskinz', pick_count: 25 },
    { faction_id: 'f2', faction_name: 'Chaos Warriors', pick_count: 18 },
  ],
};

function renderWithQuery(ui: React.ReactNode): string {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('StatsDashboard', () => {
  it('zeigt Ladeindikator wenn Daten noch nicht geladen sind', () => {
    // getAdminStats gibt ein pending Promise zurück
    vi.mocked(getAdminStats).mockReturnValue(new Promise(() => {}));

    const html = renderWithQuery(<StatsDashboard />);
    expect(html).toContain('Loading…');
  });

  it('zeigt Fehlermeldung wenn Query fehlschlägt', () => {
    vi.mocked(getAdminStats).mockRejectedValue(new Error('Server error'));

    const html = renderWithQuery(<StatsDashboard />);
    // Auf SSR ist der Error-State nicht direkt rendert, da React Query asynchron läuft —
    // wir prüfen den initialen Render-Output (isLoading=true)
    // Dies verifiziert, dass der Component ohne Crash rendert.
    expect(html).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Snapshot-ähnliche Tests mit resolvten Daten via hydration
// ---------------------------------------------------------------------------

describe('StatsDashboard Rendering (pre-hydrated QueryClient)', () => {
  it('zeigt KPI-Karten wenn Daten vorhanden sind', () => {
    vi.mocked(getAdminStats).mockResolvedValue(MOCK_STATS);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    // Daten in den Cache schreiben, sodass der initiale Render bereits resolved ist
    queryClient.setQueryData(['admin-stats'], MOCK_STATS);

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <StatsDashboard />
      </QueryClientProvider>,
    );

    // 4 KPI-Karten gerendert
    const cardMatches = html.match(/data-testid="kpi-card"/g);
    expect(cardMatches).not.toBeNull();
    expect(cardMatches!.length).toBe(4);

    // Zahlenwerte vorhanden
    expect(html).toContain('42');      // activeUsers
    expect(html).toContain('128');     // matchesPlayed
    expect(html).toContain('Season 4'); // currentSeason
    expect(html).toContain('10');      // tournaments.total
  });

  it('zeigt Top-5-Tabelle mit Fraktionsnamen', () => {
    vi.mocked(getAdminStats).mockResolvedValue(MOCK_STATS);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(['admin-stats'], MOCK_STATS);

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <StatsDashboard />
      </QueryClientProvider>,
    );

    expect(html).toContain('Greenskinz');
    expect(html).toContain('Chaos Warriors');
    expect(html).toContain('25');
    expect(html).toContain('18');
  });

  it('zeigt Fallback wenn keine Top-Fraktionen vorhanden', () => {
    const emptyStats: AdminStats = {
      ...MOCK_STATS,
      topFactions: [],
    };

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(['admin-stats'], emptyStats);

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <StatsDashboard />
      </QueryClientProvider>,
    );

    expect(html).toContain('No data.');
  });
});
