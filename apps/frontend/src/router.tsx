import { createRoute, createRouter } from '@tanstack/react-router';
import { rootRoute } from './routes/__root';
import { IndexPage } from './routes/IndexPage';
import { LoginPage } from './routes/LoginPage';
import { TournamentDetail } from './routes/TournamentDetail';
import { CreateTournamentPage } from './routes/CreateTournamentPage';
import { LeaderboardPage } from './routes/LeaderboardPage';
import { UserProfilePage } from './routes/UserProfilePage';

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

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  createTournamentRoute,
  tournamentDetailRoute,
  leaderboardRoute,
  userProfileRoute,
]);

export const router = createRouter({ routeTree });

// TanStack Router Module Augmentation
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
