import { Outlet, createRootRoute } from '@tanstack/react-router';
import { Header } from '@/components/layout/Header';

function RootLayout() {
  return (
    <div className="relative min-h-screen bg-karaz-iron-950 text-karaz-stone-200 antialiased">
      {/* Page-level stone texture overlay */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 bg-stone-wall-texture bg-[length:512px_512px] opacity-[0.05] mix-blend-overlay"
      />
      {/* Anchor for skip-link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-karaz-gold-400 focus:text-karaz-iron-950 focus:font-semibold focus:rounded-sm"
      >
        Skip to content
      </a>
      <div className="relative z-10">
        <Header />
        <Outlet />
      </div>
    </div>
  );
}

export const rootRoute = createRootRoute({ component: RootLayout });
