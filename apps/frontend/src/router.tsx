import { createRoute, createRouter } from '@tanstack/react-router';
import { rootRoute } from './routes/__root';
import { IndexPage } from './routes/IndexPage';
import { LoginPage } from './routes/LoginPage';
import { TournamentDetail } from './routes/TournamentDetail';
import { CreateTournamentPage } from './routes/CreateTournamentPage';
import { LeaderboardPage } from './routes/LeaderboardPage';
import { UserProfilePage } from './routes/UserProfilePage';
import { MetaDashboard } from './routes/MetaDashboard';
import { FactionListPage } from './routes/FactionListPage';
import { FactionDetailPage } from './routes/FactionDetailPage';

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

const createTournamentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tournaments/create',
  component: CreateTournamentPage,
});

const tournamentDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tournaments/$slug',
  component: TournamentDetail,
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

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  createTournamentRoute,
  tournamentDetailRoute,
  leaderboardRoute,
  userProfileRoute,
  metaRoute,
  factionListRoute,
  factionDetailRoute,
]);

export const router = createRouter({ routeTree });

// TanStack Router Module Augmentation
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
