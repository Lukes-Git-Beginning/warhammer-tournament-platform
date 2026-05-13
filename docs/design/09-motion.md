# 09 — Motion

Motion is **rare** and **deliberate**. Karaz Lists is not a website that
bounces. Animations exist to express weight (a button being pressed), to
reveal heraldic information (a sigil unfolding), or to signal liveness
(a forge-pulse on an active draft). They never exist to entertain.

If a reduced-motion user disables animations, the site must remain fully
beautiful and functional — most of our motion is decorative polish, not
load-bearing UX.

## Easing curves

| Token         | Curve                              | Sensation                                   |
|---------------|------------------------------------|---------------------------------------------|
| `ease-forge`  | `cubic-bezier(0.2, 0.8, 0.2, 1.4)` | Overshoot. Impact. Hammer strike.           |
| `ease-burn`   | `cubic-bezier(0.4, 0, 0.2, 1)`     | **Default.** Smooth, deliberate, no bounce. |
| `ease-quick`  | `cubic-bezier(0.4, 0, 1, 1)`       | Fast exit, no easing out. Dismiss.          |

Choose by metaphor:
- *Something arrived / appeared* → `ease-forge` (impact).
- *Something is changing state* → `ease-burn`.
- *Something is leaving* → `ease-quick`.

## Durations

| Token              | Value   | Use                                                   |
|--------------------|---------|-------------------------------------------------------|
| `duration-instant` | `80ms`  | Cursor feedback, focus ring fade-in.                  |
| `duration-fast`    | `160ms` | Color hover, opacity hover.                           |
| `duration-base`    | `240ms` | **Default.** Most state changes.                      |
| `duration-medium`  | `320ms` | Modal open, sheet slide, dropdown reveal.             |
| `duration-slow`    | `560ms` | Page-section entrance, card stagger.                  |
| `duration-epic`    | `1000ms`| Hero sigil draw, first-paint reveal.                  |

---

## Interaction recipes

### Button press (forge variant)

```css
.btn-forge {
  transition: transform var(--duration-fast) var(--ease-burn),
              background var(--duration-fast) var(--ease-burn),
              box-shadow var(--duration-fast) var(--ease-burn);
}
.btn-forge:hover { transform: translateY(-1px); box-shadow: var(--shadow-karaz-forge-glow); }
.btn-forge:active { transform: translateY(0); transition-duration: var(--duration-instant); }
```

The press *returns* faster than it lifts — feels like a hammer rebounding.

### Card hover (banner card)

```css
.card-banner {
  transition: transform var(--duration-base) var(--ease-burn),
              border-color var(--duration-base) var(--ease-burn),
              box-shadow var(--duration-base) var(--ease-burn);
}
.card-banner:hover { transform: translateY(-2px); }
```

### Focus ring

```css
.focusable:focus-visible {
  outline: none;
  box-shadow: var(--shadow-karaz-gold-glow);
  transition: box-shadow var(--duration-instant) var(--ease-burn);
}
```

---

## Named animations (Tailwind utilities)

Define these in the `@theme` block; they become Tailwind utilities like
`animate-karaz-pulse`.

| Utility class           | Behavior                                                       | Where                              |
|-------------------------|----------------------------------------------------------------|------------------------------------|
| `animate-karaz-pulse`   | Soft 1.5s breathing pulse on the live-state dot in `forge` badges. | LIVE pill on Active Musters.     |
| `animate-karaz-ember`   | 2.5s flicker on forge-themed background gradients.              | Forge CTA bg, "live now" cards.   |
| `animate-karaz-rise`    | 700ms entrance: fade + 16px translate-y from below.             | Section content on viewport entry. |
| `animate-karaz-draw`    | 1500ms stroke-dasharray draw for SVG sigil reveal.              | Hero sigil first-paint.            |
| `animate-karaz-shimmer` | 3s conic-gradient sweep across gold elements (subtle).          | Sigil hover, champion badge.       |

### `@keyframes` definitions

```css
@keyframes karaz-pulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(216,99,42,0.4); }
  50%      { opacity: 0.7; box-shadow: 0 0 0 6px rgba(216,99,42,0); }
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
  to { stroke-dashoffset: 0; }
}

@keyframes karaz-shimmer {
  from { background-position: -200% 0; }
  to   { background-position: 200% 0; }
}
```

---

## Scroll-driven animations (no JS)

For parallax and reveal-on-scroll, we use the native CSS
**[scroll-driven animations](https://developer.chrome.com/docs/css-ui/scroll-driven-animations)**
API. No JS = no jank, perfect 60fps, free for reduced-motion users (it
respects the system preference automatically).

### Section reveal on viewport entry

```css
@supports (animation-timeline: view()) {
  .karaz-reveal {
    animation: karaz-rise linear both;
    animation-timeline: view();
    animation-range: entry 0% entry 50%;
  }
}

@supports not (animation-timeline: view()) {
  /* fallback: simple fade-in, no scroll-linked */
  .karaz-reveal { animation: karaz-rise var(--duration-slow) var(--ease-burn) both; }
}
```

### Parallax hero photo

```css
@supports (animation-timeline: scroll()) {
  .karaz-parallax-hero {
    animation: karaz-parallax linear;
    animation-timeline: scroll(root);
    animation-range: 0 100vh;
  }
}

@keyframes karaz-parallax {
  to { transform: translateY(-20%); }
}
```

### Sticky-header progress bar

```css
@supports (animation-timeline: scroll()) {
  .karaz-progress {
    animation: karaz-progress linear;
    animation-timeline: scroll(root);
    transform-origin: left;
  }
}

@keyframes karaz-progress {
  from { transform: scaleX(0); }
  to   { transform: scaleX(1); }
}
```

---

## `motion` library (for component-level orchestration)

Where CSS doesn't reach — orchestrated entrance sequences, drag, gesture,
spring physics — use the [`motion`](https://motion.dev) library (formerly
Framer Motion).

### Default spring

```tsx
import { motion } from 'motion/react';

const karazSpring = {
  type: 'spring',
  stiffness: 320,
  damping: 28,
  mass: 0.8,
} as const;
```

### Stagger pattern (Active Musters grid)

```tsx
import { motion } from 'motion/react';

<motion.ul
  initial="hidden"
  whileInView="visible"
  viewport={{ once: true, amount: 0.2 }}
  variants={{
    hidden: {},
    visible: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
  }}
>
  {tournaments.map((t) => (
    <motion.li
      key={t.id}
      variants={{
        hidden: { opacity: 0, y: 20 },
        visible: { opacity: 1, y: 0, transition: karazSpring },
      }}
    >
      <BannerCard tournament={t} />
    </motion.li>
  ))}
</motion.ul>
```

### Page transition (View Transitions API)

Use the native [`document.startViewTransition`](https://developer.mozilla.org/en-US/docs/Web/API/View_Transitions_API)
wired through TanStack Router. Keeps the route change feeling like a *fade
between stone tablets* rather than a hard cut.

```tsx
// in router.tsx
import { createRouter } from '@tanstack/react-router';

export const router = createRouter({
  routeTree,
  defaultViewTransition: true,
});
```

Pair with a CSS rule:

```css
@view-transition { navigation: auto; }

::view-transition-old(root),
::view-transition-new(root) {
  animation-duration: 320ms;
  animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
}
```

---

## Hero sigil reveal (the wow moment)

The single most ceremonial animation on the site. Plays once when the
landing page first paints. Total duration: **~1.4s**.

### Sequence

| ms     | What happens                                                              |
|--------|---------------------------------------------------------------------------|
| 0      | Hero photo present (object-fit: cover), 0.6 brightness.                   |
| 0      | Sigil SVG stroke-dasharray fully offset (invisible).                      |
| 100    | Stroke begins drawing — outer frame first.                                |
| 400    | Inner double-frame fades in (opacity 0 → 0.6).                            |
| 600    | Karaz rune mark draws.                                                    |
| 900    | Crossed hammers below draw.                                               |
| 1100   | Gold glow halo around sigil fades in (`shadow-karaz-gold-glow` on parent). |
| 1100   | Hero photo brightens 0.6 → 1.0.                                           |
| 1300   | Wordmark "KARAZ LISTS" fades in + translates from y:+8.                   |
| 1500   | Tagline + CTAs stagger in (80ms between each).                            |

Implementation: `motion` orchestrator wrapping CSS-defined SVG path
animations.

### Reduced-motion fallback

If `(prefers-reduced-motion: reduce)`:
- Skip the stroke-draw, the photo-brightness ramp, and the wordmark slide.
- Render the final state directly with a single 240ms opacity fade.

---

## Reduced motion — the audit

This is non-negotiable. Every animation declared in this file must check the
preference:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

PLUS: programmatic motion (motion-lib orchestrators, View Transitions, JS
scroll listeners) must check via `useReducedMotion()` from `motion/react`
or `window.matchMedia('(prefers-reduced-motion: reduce)')` and degrade
gracefully (cut to final state, no animation).

---

## Performance budget

| Constraint                              | Threshold                              |
|------------------------------------------|----------------------------------------|
| Animations running concurrently          | ≤ 4 per viewport                       |
| Long-running animations (>1s)            | ≤ 1 per viewport, hero only            |
| `box-shadow` and `filter` animations     | Sparingly — they trigger paint         |
| Animate `transform` and `opacity` only   | **Strong preference** (composite-only) |
| FPS in DevTools                          | ≥ 60fps on M2 / mid-tier Android       |
| `will-change` usage                      | Only on the hero sigil container during the 1.4s reveal; remove after |

---

## Anti-patterns

- ❌ Don't animate hover transitions over 240ms. Slow hovers feel unresponsive.
- ❌ Don't animate `width` / `height` / `top` / `left` — use `transform`.
- ❌ Don't loop animations infinitely except for `karaz-pulse` (live state)
  and `karaz-ember` (forge bg). Avoid eye-fatigue.
- ❌ Don't stack 3+ animations on the same element.
- ❌ Don't use `transition: all`.
- ❌ Don't ignore `prefers-reduced-motion`. This is a brand promise.
- ❌ Don't use bouncy "elastic" easings outside of `ease-forge` for buttons.
  Bounce is reserved for *one* metaphor: the hammer strike.

## Related

- [03-tokens.md](./03-tokens.md) — easing/duration token table
- [08-components.md](./08-components.md) — component-specific motion (button press, badge pulse)
- [11-accessibility.md](./11-accessibility.md) — reduced-motion audit checklist
- [12-hero-anatomy.md](./12-hero-anatomy.md) — full hero-sigil reveal storyboard
