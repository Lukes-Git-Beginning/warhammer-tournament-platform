# 14 — Implementation

This file contains the **exact, copy-pasteable code and commands** to apply
the design system to the codebase. Every other file in `docs/design/` is the
*spec*; this is the *patch*.

If you're a sub-agent reading this to do an implementation pass: read this
file plus `03-tokens.md` and `08-components.md`. Those three are sufficient
to execute Phase B + C of the rollout.

---

## Phase B — `apps/frontend/src/app.css` rewrite

Replace the entire file contents with this:

```css
/*
 * Karaz Lists — Tailwind v4 CSS-first configuration.
 * Source of truth for all design tokens.
 * See docs/design/03-tokens.md and docs/design/05-color-system.md
 * for the meaning of each token.
 */

@import "tailwindcss";

@theme {
  /* ─────────────────────────────────────────────────────────── */
  /* Font tokens                                                  */
  /* ─────────────────────────────────────────────────────────── */
  --font-display: "Cinzel Variable", "Cinzel", "Trajan Pro", Georgia, serif;
  --font-headline: "Cinzel Decorative", "Cinzel Variable", Georgia, serif;
  --font-sans: "Inter Variable", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: "JetBrains Mono Variable", "JetBrains Mono", "Fira Code", ui-monospace, monospace;
  --font-script: "IM Fell English", "EB Garamond", Georgia, serif;

  /* ─────────────────────────────────────────────────────────── */
  /* Color tokens — Iron & Stone (base)                            */
  /* ─────────────────────────────────────────────────────────── */
  --color-karaz-obsidian: #08070A;
  --color-karaz-iron-950: #110F0E;
  --color-karaz-iron-900: #181513;
  --color-karaz-iron-800: #221E1B;
  --color-karaz-iron-700: #2D2823;
  --color-karaz-iron-600: #3D3631;
  --color-karaz-iron-500: #5C5249;
  --color-karaz-stone-400: #837A6F;
  --color-karaz-stone-300: #A89E92;
  --color-karaz-stone-200: #CCC2B6;
  --color-karaz-stone-100: #E8DFD0;
  --color-karaz-parchment: #F4E8C4;

  /* ─────────────────────────────────────────────────────────── */
  /* Color tokens — Forge, Gold, Blood, Bronze (accent)            */
  /* ─────────────────────────────────────────────────────────── */
  --color-karaz-gold-300: #F4D479;
  --color-karaz-gold-400: #E4B432;
  --color-karaz-gold-500: #D4A017;
  --color-karaz-gold-600: #A87A0E;
  --color-karaz-bronze: #B08D57;
  --color-karaz-forge-400: #E87B3D;
  --color-karaz-forge-500: #D8632A;
  --color-karaz-forge-600: #B04D18;
  --color-karaz-blood-500: #8B0000;
  --color-karaz-blood-600: #5E0000;

  /* ─────────────────────────────────────────────────────────── */
  /* Color tokens — Semantic                                       */
  /* ─────────────────────────────────────────────────────────── */
  --color-karaz-success: #6B8E5B;
  --color-karaz-warning: #D4A017;
  --color-karaz-danger: #8B0000;
  --color-karaz-info: #5D7B8F;

  /* ─────────────────────────────────────────────────────────── */
  /* Legacy aliases — migration shims (TO BE REMOVED Q3 2026)      */
  /* See docs/design/14-implementation.md "Migration" section.     */
  /* ─────────────────────────────────────────────────────────── */
  --color-warhammer-blood: var(--color-karaz-blood-500);
  --color-warhammer-gold: var(--color-karaz-gold-500);
  --color-warhammer-parchment: var(--color-karaz-parchment);
  --color-warhammer-iron: var(--color-karaz-iron-600);

  /* ─────────────────────────────────────────────────────────── */
  /* Container widths                                              */
  /* ─────────────────────────────────────────────────────────── */
  --container-tight: 40rem;
  --container-narrow: 60rem;
  --container-wide: 80rem;
  --container-full: 90rem;

  /* ─────────────────────────────────────────────────────────── */
  /* Radius — Souls-like sharp                                     */
  /* ─────────────────────────────────────────────────────────── */
  --radius-sm: 2px;
  --radius-md: 4px;
  --radius-lg: 6px;
  --radius-xl: 10px;

  /* ─────────────────────────────────────────────────────────── */
  /* Shadows                                                       */
  /* ─────────────────────────────────────────────────────────── */
  --shadow-karaz-engrave:
    inset 0 1px 0 rgba(255, 255, 255, 0.04),
    inset 0 -1px 0 rgba(0, 0, 0, 0.6);
  --shadow-karaz-emboss:
    0 1px 0 rgba(255, 255, 255, 0.06),
    0 -1px 0 rgba(0, 0, 0, 0.4);
  --shadow-karaz-forge-glow:
    0 0 32px rgba(216, 99, 42, 0.35),
    0 0 8px rgba(244, 212, 121, 0.25),
    inset 0 0 0 1px rgba(244, 212, 121, 0.4);
  --shadow-karaz-gold-glow:
    0 0 24px rgba(212, 160, 23, 0.3),
    inset 0 0 0 1px rgba(212, 160, 23, 0.4);
  --shadow-karaz-banner:
    0 10px 30px rgba(0, 0, 0, 0.7),
    0 4px 8px rgba(0, 0, 0, 0.5);
  --shadow-karaz-stone-vignette:
    inset 0 0 120px rgba(0, 0, 0, 0.7);

  /* ─────────────────────────────────────────────────────────── */
  /* Easings & durations                                           */
  /* ─────────────────────────────────────────────────────────── */
  --ease-forge: cubic-bezier(0.2, 0.8, 0.2, 1.4);
  --ease-burn: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-quick: cubic-bezier(0.4, 0, 1, 1);
  --duration-instant: 80ms;
  --duration-fast: 160ms;
  --duration-base: 240ms;
  --duration-medium: 320ms;
  --duration-slow: 560ms;
  --duration-epic: 1000ms;

  /* ─────────────────────────────────────────────────────────── */
  /* Named animations (exposed as Tailwind utilities)              */
  /* ─────────────────────────────────────────────────────────── */
  --animate-karaz-pulse: karaz-pulse 1.5s var(--ease-burn) infinite;
  --animate-karaz-ember: karaz-ember 2.5s var(--ease-burn) infinite;
  --animate-karaz-rise: karaz-rise var(--duration-slow) var(--ease-burn) both;
  --animate-karaz-draw: karaz-draw 1.5s var(--ease-burn) forwards;
  --animate-karaz-shimmer: karaz-shimmer 3s linear infinite;
}

/* ───────────────────────────────────────────────────────────── */
/* Keyframes                                                      */
/* ───────────────────────────────────────────────────────────── */
@keyframes karaz-pulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(216, 99, 42, 0.4); }
  50%      { opacity: 0.7; box-shadow: 0 0 0 6px rgba(216, 99, 42, 0); }
}

@keyframes karaz-ember {
  0%, 100% { opacity: 0.6; filter: hue-rotate(0deg); }
  50%      { opacity: 1.0; filter: hue-rotate(-6deg); }
}

@keyframes karaz-rise {
  from { opacity: 0; transform: translateY(16px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes karaz-draw {
  from { stroke-dashoffset: var(--karaz-draw-length, 1000); }
  to   { stroke-dashoffset: 0; }
}

@keyframes karaz-shimmer {
  from { background-position: -200% 0; }
  to   { background-position: 200% 0; }
}

/* ───────────────────────────────────────────────────────────── */
/* Base styles                                                    */
/* ───────────────────────────────────────────────────────────── */
html {
  font-family: var(--font-sans);
  background: var(--color-karaz-iron-950);
  color: var(--color-karaz-stone-200);
  color-scheme: dark;
}

body {
  font-feature-settings: "ss01", "ss02", "cv11", "calt", "liga";
  font-variant-numeric: tabular-nums;
  min-height: 100svh;
  background: var(--color-karaz-iron-950);
}

/* Headings: display font, light heading color */
h1, h2, h3, h4, h5, h6 {
  font-family: var(--font-display);
  color: var(--color-karaz-stone-100);
  letter-spacing: 0.02em;
}

/* Selection — gold ink, dark text */
::selection {
  background: var(--color-karaz-gold-500);
  color: var(--color-karaz-iron-950);
}

/* Focus-visible — gold ring */
:focus-visible {
  outline: 2px solid var(--color-karaz-gold-500);
  outline-offset: 2px;
}

/* Scrollbar — slim, in keeping with the aesthetic */
* {
  scrollbar-width: thin;
  scrollbar-color: var(--color-karaz-iron-600) transparent;
}

/* Drop-cap utility */
.dropcap::first-letter {
  font-family: var(--font-script);
  font-size: 4.5em;
  float: left;
  line-height: 0.85;
  margin-right: 0.12em;
  margin-top: 0.05em;
  color: var(--color-karaz-gold-400);
  text-shadow: 0 0 12px rgba(212, 160, 23, 0.3);
}
.dropcap-stone::first-letter {
  color: var(--color-karaz-stone-100);
  text-shadow: none;
}

/* Engraved seam separator */
.karaz-seam {
  height: 1px;
  background-image: linear-gradient(
    to right,
    transparent 0%,
    var(--color-karaz-iron-600) 10%,
    var(--color-karaz-bronze) 50%,
    var(--color-karaz-iron-600) 90%,
    transparent 100%
  );
}

/* Photo overlay frame */
.karaz-photo-frame {
  position: relative;
  overflow: hidden;
}
.karaz-photo-frame::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    135deg,
    rgba(216, 99, 42, 0.06) 0%,
    transparent 40%,
    rgba(8, 7, 10, 0.20) 100%
  );
  mix-blend-mode: multiply;
  pointer-events: none;
}
.karaz-photo-frame::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    transparent 0%,
    transparent 45%,
    rgba(17, 15, 14, 0.6) 80%,
    rgba(17, 15, 14, 0.92) 100%
  );
  pointer-events: none;
}
.karaz-photo-frame > img,
.karaz-photo-frame > video {
  filter: saturate(0.85) contrast(1.05);
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* Reduced-motion override */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}

/* View transitions (TanStack Router will invoke startViewTransition) */
@view-transition { navigation: auto; }

::view-transition-old(root),
::view-transition-new(root) {
  animation-duration: 320ms;
  animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
}
```

---

## Phase C — shadcn/ui bootstrap

### Step 1 — install dependencies

```pwsh
pnpm -F @tww3/frontend add `
  class-variance-authority `
  clsx `
  tailwind-merge `
  lucide-react `
  motion `
  @radix-ui/react-slot
```

Then the @fontsource font packages for self-hosted variable fonts (no
Google Fonts roundtrip in production):

```pwsh
pnpm -F @tww3/frontend add `
  @fontsource-variable/cinzel `
  @fontsource-variable/inter `
  @fontsource-variable/jetbrains-mono `
  @fontsource/im-fell-english `
  @fontsource/cinzel-decorative
```

Then import them once in `apps/frontend/src/main.tsx`:

```ts
import '@fontsource-variable/cinzel';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource/im-fell-english';
import '@fontsource/cinzel-decorative/400.css';
import '@fontsource/cinzel-decorative/700.css';
import './app.css';
```

### Step 2 — `lib/utils.ts` (cn helper)

`apps/frontend/src/lib/utils.ts`:

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

### Step 3 — `components.json` (shadcn config)

`apps/frontend/components.json`:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/app.css",
    "baseColor": "stone",
    "cssVariables": false,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

(`cssVariables: false` because we control tokens via Tailwind v4 `@theme`,
not shadcn's HSL-variable scheme.)

### Step 4 — install primitives

```pwsh
pnpm -F @tww3/frontend dlx shadcn@latest add button card input label textarea select checkbox switch radio-group dialog sheet dropdown-menu tooltip tabs badge separator sonner skeleton scroll-area avatar
```

After install, each generated component in `src/components/ui/` is hand-edited
to apply Karaz variants (see [08-components.md](./08-components.md) for the
full spec of each variant).

The most important rewrite is `button.tsx` — paste the `cva` definition from
[08-components.md](./08-components.md) into the generated file, replacing
the default variants entirely.

---

## Phase D — Hero-page rewrite

### Step 1 — landing-page section components

Create the directory `apps/frontend/src/components/landing/` with these files:

```
HeroSection.tsx
ForgeSection.tsx
ActiveMustersSection.tsx
RollOfHonourSection.tsx
ConclaveSection.tsx
SigillumSection.tsx
Footer.tsx
ScrollCue.tsx          (small helper for Hero)
ArchHeader.tsx         (gothic-arch SVG above feature columns in Conclave)
```

Each section component renders its own `<section>` element and is dropped
into `IndexPage.tsx` in order.

Implementation details are guided by [12-hero-anatomy.md](./12-hero-anatomy.md)
and [08-components.md](./08-components.md).

### Step 2 — `IndexPage.tsx` rewrite

```tsx
import { HeroSection } from '@/components/landing/HeroSection';
import { ForgeSection } from '@/components/landing/ForgeSection';
import { ActiveMustersSection } from '@/components/landing/ActiveMustersSection';
import { RollOfHonourSection } from '@/components/landing/RollOfHonourSection';
import { ConclaveSection } from '@/components/landing/ConclaveSection';
import { SigillumSection } from '@/components/landing/SigillumSection';
import { Footer } from '@/components/landing/Footer';

export function IndexPage() {
  return (
    <>
      <main id="main-content">
        <HeroSection />
        <ForgeSection />
        <ActiveMustersSection />
        <RollOfHonourSection />
        <ConclaveSection />
        <SigillumSection />
      </main>
      <Footer />
    </>
  );
}
```

### Step 3 — `Header.tsx` rebrand

In `apps/frontend/src/components/layout/Header.tsx`:

- Replace the hardcoded text `TWW3 Cup` (line 52) with a `<KarazSigilWordmark />`
  lockup component (sigil + "KARAZ LISTS" wordmark side-by-side).
- Update nav link classes: replace `text-warhammer-gold` →
  `text-karaz-gold-500`, replace `text-stone-300` → `text-karaz-stone-300`.
- Wrap navigation in `<nav aria-label="Primary">`.
- Mobile menu trigger now uses Lucide `Menu` / `X` icons (`size-5`,
  `stroke-width-1.5`).
- Login button → use the new `<Button variant="forge" size="sm">Take Up
  Arms</Button>`.

### Step 4 — `__root.tsx` updates

```tsx
import { Outlet, createRootRoute } from '@tanstack/react-router';
import { Header } from '@/components/layout/Header';

function RootLayout() {
  return (
    <div className="min-h-screen bg-karaz-iron-950 text-karaz-stone-200 antialiased">
      {/* Page-level stone texture (4-6% opacity) */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 bg-[url('/textures/stone-wall.png')] bg-[length:512px_512px] opacity-[0.05] mix-blend-overlay"
      />
      <div className="relative z-10">
        <Header />
        <Outlet />
      </div>
    </div>
  );
}

export const rootRoute = createRootRoute({ component: RootLayout });
```

### Step 5 — `router.tsx` view transitions

Add the `defaultViewTransition` option:

```tsx
export const router = createRouter({
  routeTree,
  defaultViewTransition: true,
});
```

---

## Phase E — Repo / meta branding

### `apps/frontend/index.html`

Replace the existing `<head>` block (per [12-hero-anatomy.md](./12-hero-anatomy.md))
with the Karaz Lists meta block, font preconnect, and updated favicon.

Body class becomes:

```html
<body class="min-h-screen bg-karaz-iron-950 text-karaz-stone-200 antialiased">
```

### `apps/frontend/public/favicon.svg`

Placeholder SVG that uses the same line-drawing as `KarazSigil.tsx`. Production
asset is replaced once the Gemini-generated SVG lands.

### Root `README.md`

Top of file:

```md
# Karaz Lists

> *Where Lists Are Forged.*

Tournament platform for Warhammer: The Old World.
Built on Fastify · Prisma · Socket.IO · React 19 · Tailwind v4 · TanStack Router.
```

The rest of the existing README content stays — only the title and short
intro change.

### Root `CLAUDE.md`

Add a new row at the top of the `.knowledge/-Verweise` table:

```md
| Design-System, Tokens, Voice, Branding  | `docs/design/README.md`           |
```

This makes the design system discoverable for sub-agents via the standard
hub-pattern.

---

## Migration policy — old `warhammer-*` Tailwind classes

The Tailwind classes `bg-warhammer-blood`, `text-warhammer-gold`, etc. are
**deprecated** but kept temporarily via the alias block in the `@theme`
above.

Migration order (separate PRs after Welle 1 lands):

1. `apps/frontend/src/components/auth/*` — light, isolated.
2. `apps/frontend/src/components/tournament/*` — most usage.
3. `apps/frontend/src/components/draft/*`, `meta/*`, `bracket/*`.
4. `apps/frontend/src/routes/*`.
5. Once `grep -r "warhammer-" apps/frontend/src` returns nothing, remove
   the alias block from `@theme`.

Target: aliases removed by end of Q3 2026.

---

## Verification — end of Welle 1

After all phases applied:

```pwsh
# Type-check
pnpm -F @tww3/frontend typecheck

# Build
pnpm -F @tww3/frontend build

# Lint (will flag any obvious mistakes)
pnpm -F @tww3/frontend lint

# Dev server — open browser at http://localhost:5173
pnpm -F @tww3/frontend dev
```

Browser smoke-test (per [12-hero-anatomy.md](./12-hero-anatomy.md)):

- [ ] Tab title reads "Karaz Lists — Where Lists Are Forged".
- [ ] Hero renders, sigil animates once on first paint.
- [ ] All 7 sections present and scrollable.
- [ ] Header shows Karaz Sigil + "KARAZ LISTS" wordmark.
- [ ] Buttons show forge-glow on hover.
- [ ] `prefers-reduced-motion: reduce` (OS toggle) disables animations.
- [ ] Lighthouse Accessibility ≥ 95.

## Related

- [03-tokens.md](./03-tokens.md) — token definitions
- [08-components.md](./08-components.md) — component specs
- [12-hero-anatomy.md](./12-hero-anatomy.md) — landing-page sections
- [13-asset-generation.md](./13-asset-generation.md) — AI prompts to produce the imagery referenced here
