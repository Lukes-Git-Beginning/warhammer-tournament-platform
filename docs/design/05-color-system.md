# 05 — Color System

The full palette. Every color, every variant, every contrast pair, every
gradient. This file complements [03-tokens.md](./03-tokens.md) — tokens.md is
the index; this is the *atlas*.

## The rule

> **Anthracite, with a single warm spark.**
> 90% of the screen is iron/stone. The remaining 10% is gold or forge, used
> for *one* focal point per viewport.

If a screen has two competing accent points, one is wrong. The hero photo
counts as its own focal point — do not add a glowing CTA *and* a glowing
chip *and* a forge-colored banner all visible at once.

---

## Full palette — values + perceptual

All values shown in HEX (canonical) and OKLCH (for `color-mix()` math and
contrast comparison). OKLCH values are approximate (rounded for readability).

### Iron / Stone — base

| Token              | HEX        | OKLCH                  | Contrast on `iron-950` | Use                                |
|--------------------|------------|------------------------|------------------------|------------------------------------|
| `karaz-obsidian`   | `#08070A`  | `oklch(0.08 0.005 280)`| —                      | Modal overlay 60% opacity, void.   |
| `karaz-iron-950`   | `#110F0E`  | `oklch(0.12 0.005 50)` | —                      | Page bg.                           |
| `karaz-iron-900`   | `#181513`  | `oklch(0.16 0.008 55)` | —                      | Card bg.                           |
| `karaz-iron-800`   | `#221E1B`  | `oklch(0.21 0.011 55)` | —                      | Elevated surface.                  |
| `karaz-iron-700`   | `#2D2823`  | `oklch(0.27 0.014 60)` | —                      | Subtle border.                     |
| `karaz-iron-600`   | `#3D3631`  | `oklch(0.35 0.016 60)` | —                      | Default border.                    |
| `karaz-iron-500`   | `#5C5249`  | `oklch(0.50 0.018 60)` | —                      | Strong border, focus on dark.      |
| `karaz-stone-400`  | `#837A6F`  | `oklch(0.65 0.020 65)` | 4.9 : 1                | Muted text.                        |
| `karaz-stone-300`  | `#A89E92`  | `oklch(0.75 0.018 70)` | 7.5 : 1                | Secondary text.                    |
| `karaz-stone-200`  | `#CCC2B6`  | `oklch(0.85 0.018 75)` | 11.3 : 1               | Body text (default).               |
| `karaz-stone-100`  | `#E8DFD0`  | `oklch(0.92 0.020 80)` | 14.7 : 1               | Heading text.                      |
| `karaz-parchment`  | `#F4E8C4`  | `oklch(0.94 0.045 90)` | 15.6 : 1               | Rare highlight, drop-cap bg.       |

### Accent — Gold

| Token              | HEX        | OKLCH                   | Contrast on `iron-950` | Use                              |
|--------------------|------------|-------------------------|------------------------|----------------------------------|
| `karaz-gold-300`   | `#F4D479`  | `oklch(0.88 0.115 90)`  | 12.7 : 1               | Glow highlight (hovered gold).   |
| `karaz-gold-400`   | `#E4B432`  | `oklch(0.78 0.155 85)`  | 9.4 : 1                | **Primary CTA fill.**            |
| `karaz-gold-500`   | `#D4A017`  | `oklch(0.72 0.155 80)`  | 7.6 : 1                | Brand accent default.            |
| `karaz-gold-600`   | `#A87A0E`  | `oklch(0.58 0.135 75)`  | 4.8 : 1                | CTA pressed / active.            |

### Accent — Forge (heat)

| Token              | HEX        | OKLCH                   | Contrast on `iron-950` | Use                              |
|--------------------|------------|-------------------------|------------------------|----------------------------------|
| `karaz-forge-400`  | `#E87B3D`  | `oklch(0.69 0.180 45)`  | 6.7 : 1                | Heat highlight.                  |
| `karaz-forge-500`  | `#D8632A`  | `oklch(0.62 0.190 40)`  | 5.3 : 1                | Urgent CTA, live state.          |
| `karaz-forge-600`  | `#B04D18`  | `oklch(0.51 0.170 38)`  | 3.7 : 1                | Heat pressed.                    |

### Accent — Blood, Bronze

| Token              | HEX        | OKLCH                   | Contrast on `iron-950` | Use                              |
|--------------------|------------|-------------------------|------------------------|----------------------------------|
| `karaz-blood-500`  | `#8B0000`  | `oklch(0.40 0.200 30)`  | 2.5 : 1                | Danger fill.                     |
| `karaz-blood-600`  | `#5E0000`  | `oklch(0.27 0.165 30)`  | 1.6 : 1                | Danger pressed.                  |
| `karaz-bronze`     | `#B08D57`  | `oklch(0.62 0.085 75)`  | 5.1 : 1                | Secondary metal, divider.        |

### Semantic — mapped

| Token              | Resolves to            | HEX     | Contrast on `iron-950` |
|--------------------|------------------------|---------|------------------------|
| `karaz-success`    | (heath green)          | `#6B8E5B` | 4.7 : 1              |
| `karaz-warning`    | → `gold-500`           | `#D4A017` | 7.6 : 1              |
| `karaz-danger`     | → `blood-500`          | `#8B0000` | 2.5 : 1 ⚠️           |
| `karaz-info`       | (slate-blue)           | `#5D7B8F` | 4.4 : 1              |

⚠️ **Blood contrast warning**: `karaz-blood-500` alone on `karaz-iron-950` is
under WCAG-AA 4.5:1 minimum for text. Use `karaz-blood-500` only as a *fill*
(button bg, badge bg) and pair with `karaz-stone-100` text. **Never** use it
as raw text color on dark surfaces.

---

## Contrast pairs (WCAG AA ≥ 4.5:1 for body text)

| Foreground          | Background           | Ratio    | Verdict          |
|---------------------|----------------------|----------|------------------|
| `stone-200` (body)  | `iron-950` (page)    | 11.3 : 1 | ✅ AAA          |
| `stone-200`         | `iron-900` (card)    | 9.8 : 1  | ✅ AAA          |
| `stone-300`         | `iron-900`           | 6.5 : 1  | ✅ AA Large +   |
| `stone-400` (muted) | `iron-950`           | 4.9 : 1  | ✅ AA           |
| `stone-400`         | `iron-900` (card)    | 4.2 : 1  | ⚠️ AA-Large only |
| `gold-400` (CTA)    | `iron-950`           | 9.4 : 1  | ✅ AAA          |
| `iron-950` (text)   | `gold-400` (fill)    | 9.4 : 1  | ✅ AAA          |
| `iron-950`          | `gold-500`           | 7.6 : 1  | ✅ AAA          |
| `iron-950`          | `forge-500`          | 5.3 : 1  | ✅ AA           |
| `stone-100`         | `blood-500`          | 5.9 : 1  | ✅ AA           |
| `stone-100`         | `forge-500`          | 2.8 : 1  | ❌ insufficient — use `iron-950` text |

**Rule**: text on accent fills uses `karaz-iron-950` (deep page color), not
`stone-100` — the warm fills (gold, forge) are tuned for dark text. Only
`blood-500` takes light text.

---

## Gradients (use sparingly)

Gradients on Karaz Lists are atmospheric — they evoke firelight, dawn,
weathered stone. Never decorative-for-decoration.

### Forge glow (radial, for CTA backgrounds in hero zones)

```css
background: radial-gradient(
  ellipse at center,
  rgba(216, 99, 42, 0.4) 0%,
  rgba(216, 99, 42, 0.1) 40%,
  transparent 70%
);
```

### Stone vignette (page-level edge darkening)

```css
background-image: radial-gradient(
  ellipse at center,
  transparent 40%,
  rgba(8, 7, 10, 0.85) 100%
);
```

### Engraved seam (used on horizontal divider strips)

```css
background: linear-gradient(
  to right,
  transparent 0%,
  var(--color-karaz-iron-600) 10%,
  var(--color-karaz-bronze) 50%,
  var(--color-karaz-iron-600) 90%,
  transparent 100%
);
height: 1px;
```

### Dawn-on-stone (rare, hero photo overlay only)

```css
background: linear-gradient(
  180deg,
  transparent 0%,
  transparent 50%,
  rgba(17, 15, 14, 0.85) 100%
);
```

### Gold leaf shimmer (for sigil hovers)

Use a CSS conic-gradient combined with `mask-image` for an animated metallic
catch. Recipe in [09-motion.md](./09-motion.md).

---

## Color-mix utilities

Tailwind v4 + modern CSS lets us derive colors at runtime. Useful for:

```css
/* a 12%-opacity tint of the brand gold for hover backgrounds */
background: color-mix(in oklch, var(--color-karaz-gold-500) 12%, transparent);

/* a slightly desaturated stone for disabled state */
color: color-mix(in oklch, var(--color-karaz-stone-300) 50%, var(--color-karaz-iron-700));
```

Use `color-mix` instead of inventing new tokens for hover/disabled
variants — keeps the palette compact.

---

## Faction colors (separate concern)

Each Warhammer faction has its own color identity (Empire blue, Bretonnia
red/blue, Dwarfs orange, Skaven green, etc.). These live in their own map
under `apps/frontend/src/lib/faction-colors.ts` (or similar) and are **not**
considered part of the design system tokens — they are *content*.

The design system provides a **neutral container** (`iron-900` card +
`iron-600` border) and the faction's own color appears as:
- A small colored bar on the left edge of the card (4–6px wide).
- The faction icon's natural tint.
- A subtle 8% color-mix tint on the card background, optional.

It **never** colors the entire card, button, or text — that would break the
"single warm spark" rule.

---

## Dark mode only

Karaz Lists has no light mode. There is no plan to add one. The inspirational
photography, the heraldic identity, and the FromSoftware-grade aesthetic all
collapse under bright backgrounds. We do not negotiate this.

`prefers-color-scheme: light` is *ignored* — the site renders dark regardless.
We do not add `class="dark"` toggles to elements; the entire app is
dark-by-default in CSS.

---

## Anti-patterns

- ❌ Don't use raw Tailwind `stone-950`, `amber-500`, `red-700`. Use Karaz tokens
  exclusively. The old `--color-warhammer-*` aliases exist only as a temporary
  migration shim (see [14-implementation.md](./14-implementation.md)).
- ❌ Don't add a second accent color "for variety". The accent is gold (or
  forge for heat). Period.
- ❌ Don't tint backgrounds with the brand gold. A card with `bg-gold-500/10`
  reads cheap. Use `iron-900` and accent via *border* or *icon*.
- ❌ Don't use pure white (`#FFFFFF`) anywhere. `karaz-stone-100` is our brightest.
- ❌ Don't use pure black either. `karaz-obsidian` (`#08070A`) is reserved for
  overlays only; the page background is `karaz-iron-950` which is intentionally
  warm-shifted dark.

## Related

- [03-tokens.md](./03-tokens.md) — token index
- [04-typography.md](./04-typography.md) — text-color × type-role pairings
- [11-accessibility.md](./11-accessibility.md) — full contrast audit
- [14-implementation.md](./14-implementation.md) — exact `@theme` block
