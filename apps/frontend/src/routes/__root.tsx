import { Outlet, createRootRoute } from '@tanstack/react-router';
import { Header } from '@/components/layout/Header';

function RootLayout() {
  return (
    <div className="min-h-screen bg-stone-950 text-stone-100">
      <Header />
      <Outlet />
    </div>
  );
}

export const rootRoute = createRootRoute({ component: RootLayout });
