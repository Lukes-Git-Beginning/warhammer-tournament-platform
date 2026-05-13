# 06 — Iconography

Icons are silent voice. They speak as loudly as a sentence of body copy and
take up a fraction of the space. Karaz Lists treats them with the same gravity
as words.

## Two-tier system

We use **two** icon sources, layered:

| Tier | Source                            | Use                                                   |
|------|-----------------------------------|-------------------------------------------------------|
| 1    | **Lucide** (`lucide-react`)       | Functional UI — chevrons, close, search, settings, etc. |
| 2    | **Karaz custom icons**            | Heraldic / thematic — sigil, anvil, rune, hammer-cross, banner. |

Lucide covers 95% of what UI needs and stays out of the way. Custom icons
appear only when the moment is *ceremonial* (hero badges, faction
decorators, achievement medallions, drop-cap initials).

---

## Tier 1 — Lucide

[`lucide-react`](https://lucide.dev/icons/) is installed as part of the
shadcn/ui bootstrap. We use it directly.

### Rendering convention

```tsx
import { Search } from 'lucide-react';

<Search className="size-4 text-karaz-stone-300" strokeWidth={1.5} aria-hidden="true" />
```

### Stroke width

| Tier            | Stroke width   | Rationale                              |
|-----------------|----------------|----------------------------------------|
| Lucide default  | `1.5`          | **Our default.** Slightly thinner than Lucide's stock `2`, reads as engraved. |
| Decorative      | `1.25`         | For watermark/background icons.        |
| Emphatic        | `2`            | For warning/danger icons inside alerts. |

Always pass `strokeWidth` explicitly — do not rely on Lucide's default.

### Sizes (Tailwind utilities)

| Size   | Class       | Pixel  | Use                                    |
|--------|-------------|--------|----------------------------------------|
| xs     | `size-3`    | 12px   | Inline with `text-caption`.            |
| sm     | `size-4`    | 16px   | **Default UI.** Inline with body text.|
| md     | `size-5`    | 20px   | Button icons, dropdown indicators.     |
| lg     | `size-6`    | 24px   | Section headers, prominent CTAs.       |
| xl     | `size-8`    | 32px   | Empty-state illustrations.             |
| 2xl    | `size-12`   | 48px   | Feature cards, hero supporting glyphs. |

### Color

| Context                        | Tailwind class                                |
|--------------------------------|-----------------------------------------------|
| Inline with body               | `text-karaz-stone-300`                        |
| Muted (in caption row)         | `text-karaz-stone-400`                        |
| Active state                   | `text-karaz-gold-500`                         |
| Inside primary button (`forge`)| `text-karaz-iron-950`                         |
| Inside ghost button (`etched`) | `currentColor` (inherits from button text)    |
| Danger                         | `text-karaz-blood-500`                        |
| Success                        | `text-karaz-success`                          |

### Curated subset — preferred Lucide icons

Standardize on these. If you need an icon and one of these fits, use it.

| Concept             | Lucide icon            |
|---------------------|------------------------|
| Search              | `search`               |
| Filter              | `filter`               |
| Close / dismiss     | `x`                    |
| Confirm / check     | `check`                |
| More menu           | `more-horizontal`      |
| Settings            | `settings-2`           |
| User / profile      | `user`                 |
| Group / banner      | `users`                |
| Calendar            | `calendar`             |
| Time / live         | `clock`                |
| Map / location      | `map-pin`              |
| Chevron right       | `chevron-right`        |
| Chevron down        | `chevron-down`         |
| External link       | `external-link`        |
| Copy                | `copy`                 |
| Edit                | `pencil`               |
| Delete              | `trash-2`              |
| Warning             | `triangle-alert`       |
| Info                | `info`                 |
| Success             | `check-circle-2`       |
| Sort                | `arrow-up-down`        |
| Plus / add          | `plus`                 |
| Trophy / champion   | `trophy`               |
| Shield              | `shield`               |
| Sword               | `swords`               |
| Crown               | `crown`                |
| Flame / live        | `flame`                |
| Gem / achievement   | `gem`                  |

---

## Tier 2 — Karaz Custom Icons

A small, hand-crafted set that carries the heraldic identity. These do **not**
come from any external library — they are bespoke SVGs.

### Catalogue (initial set)

| Name             | Purpose                                                    | Variants                    |
|------------------|------------------------------------------------------------|-----------------------------|
| `karaz-sigil`    | The brand mark. The "K rune in a stone tablet" emblem.     | `mark` (1:1), `wordmark` (logotype-paired) |
| `karaz-anvil`    | Workshop / forge / "build" actions.                        | line / filled               |
| `karaz-hammer`   | Action / strike / submit.                                  | line / filled               |
| `karaz-banner`   | Team / banner / order.                                     | line / filled               |
| `karaz-rune`     | Achievement / decoration / drop-cap accent.                | 5 dwarf-rune variants       |
| `karaz-skull`    | Defeat / fallen state (use with restraint).                | line only                   |
| `karaz-cross-hammers` | Tournament icon — two hammers crossed.                | line / filled               |
| `karaz-scroll`   | Rules / TOS / documentation.                               | line only                   |
| `karaz-chalice`  | Champion / award.                                          | filled only                 |
| `karaz-flame-engraved` | Live / active state — stylized engraved flame.       | line / filled               |

### File layout

```
apps/frontend/src/components/icons/
  KarazSigil.tsx        — the brand mark
  KarazSigilWordmark.tsx — full logotype (sigil + "KARAZ LISTS" text)
  KarazAnvil.tsx
  KarazHammer.tsx
  KarazBanner.tsx
  KarazRune.tsx
  KarazSkull.tsx
  KarazCrossHammers.tsx
  KarazScroll.tsx
  KarazChalice.tsx
  KarazFlameEngraved.tsx
  index.ts              — barrel export
```

### Component contract

```tsx
type KarazIconProps = {
  className?: string;
  variant?: 'line' | 'filled';
  strokeWidth?: number; // line variant only, default 1.25
  'aria-label'?: string;
  'aria-hidden'?: boolean;
};
```

### Reference implementation (Karaz Sigil)

```tsx
// apps/frontend/src/components/icons/KarazSigil.tsx
import { forwardRef } from 'react';

export const KarazSigil = forwardRef<SVGSVGElement, KarazIconProps>(
  ({ className, variant = 'line', strokeWidth = 1.25, ...rest }, ref) => (
    <svg
      ref={ref}
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="square"
      strokeLinejoin="miter"
      className={className}
      role="img"
      {...rest}
    >
      {/* outer carved tablet */}
      <path d="M8 6 L56 6 L60 12 L60 52 L56 58 L8 58 L4 52 L4 12 Z" />
      {/* inner double-frame (engraving) */}
      <path d="M11 10 L53 10 L56 14 L56 50 L53 54 L11 54 L8 50 L8 14 Z" opacity="0.6" />
      {/* karaz rune — abstract K + dwarf-rune mark */}
      <path d="M22 18 L22 46 M22 32 L36 18 M22 32 L36 46 M40 18 L46 18 L46 24 L40 24 Z" />
      {/* crossed hammers below */}
      <path d="M20 50 L44 50" />
      <path d="M28 48 L30 50 L28 52" />
      <path d="M36 48 L34 50 L36 52" />
    </svg>
  ),
);
KarazSigil.displayName = 'KarazSigil';
```

This is the *placeholder* spec — the production version will be replaced by
the user-generated SVG from Gemini (see [13-asset-generation.md](./13-asset-generation.md))
once available. The component API stays identical.

---

## Sizing rules — Karaz icons specifically

| Where used               | Size              |
|--------------------------|-------------------|
| Header logo lockup       | `size-8` (32px)   |
| Hero center sigil        | `clamp(120px, 18vw, 240px)` — explicit |
| Section eyebrow accent   | `size-4` (16px)   |
| Achievement badge        | `size-12` (48px)  |
| Footer mini-sigil        | `size-6` (24px)   |

---

## Faction icons

Faction icons live separately under `public/icons/factions/` and are
*not* part of this system — they are content. Use them via `<img>` or
inline-SVG render; do not stroke-tint them (they ship with their own colors).

---

## Anti-patterns

- ❌ Don't mix Material Icons, Heroicons, or any other set. Lucide only for
  Tier 1.
- ❌ Don't use emoji in product UI. Ever. (Specs and changelogs are okay.)
- ❌ Don't increase stroke width arbitrarily. 1.5 is the default; pick from the
  defined set above.
- ❌ Don't apply `text-warhammer-gold` (deprecated alias). Use `text-karaz-gold-500`.
- ❌ Don't animate icons by default. Hover micro-rotation on functional icons is
  cliché. Sigil and chalice may animate; everything else stays still.
- ❌ Don't use the Karaz Sigil casually — it is the brand mark. Treat it like
  a logo (clear space, minimum 32px, never below).

## Related

- [03-tokens.md](./03-tokens.md) — color tokens for icon coloring
- [08-components.md](./08-components.md) — icons in button/badge composition
- [13-asset-generation.md](./13-asset-generation.md) — Gemini prompt for the production Sigil SVG
