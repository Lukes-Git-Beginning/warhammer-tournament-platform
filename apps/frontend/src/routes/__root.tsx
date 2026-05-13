import { Outlet, createRootRoute } from '@tanstack/react-router';
import { Header } from '@/components/layout/Header';
import { OnboardingOverlay } from '@/components/onboarding/OnboardingOverlay';

function RootLayout() {
  return (
    <div className="relative min-h-screen bg-karaz-iron-950 text-karaz-stone-200 antialiased">
      {/* Atmospheric Layer 1: stone-wall texture, page-wide */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 bg-stone-wall-texture bg-[length:768px_768px] opacity-[0.10] mix-blend-soft-light"
      />
      {/* Atmospheric Layer 2: forge glow rising from bottom */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 bg-karaz-forge-glow"
      />
      {/* Atmospheric Layer 3: cinematic vignette */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 bg-karaz-vignette"
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
      <OnboardingOverlay />
    </div>
  );
}

export const rootRoute = createRootRoute({ component: RootLayout });
