import { createRoute, createRouter } from '@tanstack/react-router';
import { rootRoute } from './routes/__root';
import { IndexPage } from './routes/IndexPage';
import { LoginPage } from './routes/LoginPage';
import { TournamentDetail } from './routes/TournamentDetail';
import { TournamentEditPage } from './routes/TournamentEditPage';
import { TournamentsListing } from './routes/TournamentsListing';
import { CreateTournamentPage } from './routes/CreateTournamentPage';
import { LeaderboardPage } from './routes/LeaderboardPage';
import { UserProfilePage } from './routes/UserProfilePage';
import { MetaDashboard } from './routes/MetaDashboard';
import { FactionListPage } from './routes/FactionListPage';
import { FactionDetailPage } from './routes/FactionDetailPage';
import { DraftLobbyPage } from './routes/DraftLobbyPage';
import { DraftSpectatorPage } from './routes/DraftSpectatorPage';
import { PresetListPage } from './routes/PresetListPage';
import { PresetEditorPage } from './routes/PresetEditorPage';
import { AdminPage } from './routes/AdminPage';
import { SteamConnectPage } from './routes/SteamConnectPage';
import { MatchDecisionPage } from './routes/MatchDecisionPage';
import { MatchDetailPage } from './routes/MatchDetailPage';
import { H2HPage } from './routes/H2HPage';
import { CalendarPage } from './routes/CalendarPage';

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: IndexPage,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});

export const tournamentsListingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tournaments',
  component: TournamentsListing,
  validateSearch: (search: Record<string, unknown>) => {
    const isMajor = search.major === true || search.major === 'true';
    return {
      tab: (search.tab as 'upcoming' | 'live' | 'archive' | undefined) ?? 'upcoming',
      page: typeof search.page === 'number' ? search.page : 1,
      ...(isMajor ? { major: true as const } : {}),
    };
  },
});

const createTournamentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tournaments/create',
  component: CreateTournamentPage,
});

const calendarRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tournaments/calendar',
  component: CalendarPage,
});

const tournamentDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tournaments/$slug',
  component: TournamentDetail,
});

const tournamentEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tournaments/$slug/edit',
  component: TournamentEditPage,
});

const leaderboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/leaderboard',
  component: LeaderboardPage,
});

const userProfileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/users/$id',
  component: UserProfilePage,
});

const h2hRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/users/$a/vs/$b',
  component: H2HPage,
});

const metaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/meta',
  component: MetaDashboard,
});

const factionListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/factions',
  component: FactionListPage,
});

const factionDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/factions/$id',
  component: FactionDetailPage,
});

const draftLobbyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/drafts/$id',
  component: DraftLobbyPage,
});

const draftSpectatorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/drafts/$id/spectate',
  component: DraftSpectatorPage,
});

const presetListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/presets',
  component: PresetListPage,
});

const presetNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/presets/new',
  component: PresetEditorPage,
});

const presetEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/presets/$id/edit',
  component: PresetEditorPage,
});

const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin',
  component: AdminPage,
});

const steamConnectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/connect-steam',
  component: SteamConnectPage,
  validateSearch: (search: Record<string, unknown>) => ({
    return_to: typeof search.return_to === 'string' ? search.return_to : '/',
  }),
});

const matchDecisionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/matches/$matchId/decision',
  component: MatchDecisionPage,
});

const matchDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/matches/$matchId',
  component: MatchDetailPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  tournamentsListingRoute,
  createTournamentRoute,
  calendarRoute,
  tournamentDetailRoute,
  tournamentEditRoute,
  leaderboardRoute,
  userProfileRoute,
  h2hRoute,
  metaRoute,
  factionListRoute,
  factionDetailRoute,
  draftLobbyRoute,
  draftSpectatorRoute,
  presetListRoute,
  presetNewRoute,
  presetEditRoute,
  adminRoute,
  steamConnectRoute,
  matchDetailRoute,
  matchDecisionRoute,
]);

export const router = createRouter({ routeTree });

// TanStack Router Module Augmentation
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
